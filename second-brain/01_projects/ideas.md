---
type: project
status: active
phase: beta-5
updated: 2026-05-22
related:
  - 02_architecture/module-map.md (β-5)
  - 01_projects/probe-agent.md
  - plans/archive/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md
---

# Specialist 3.6 — Ideas Collector

Шестой специалист Слоя 3. Превращает блоки `signalType ∈ {idea, feature_request}` в структурированные карточки `Idea` с поддерживающими, динамическим весом и статусом.

## Два пути рождения идеи

1. **Через Specialist 3.6** (основной, описан ниже) — блок `signalType ∈ {idea, feature_request}` → Router → `Specialist36IdeasWorker`.
2. **Direct-path на ingest** (2026-06-08) — `block-ingest.worker.ts` (~стр. 656) материализует `Idea` прямо в момент ingest'а блока, минуя специалиста, при включённом флаге `knowledge.ideaDirectPathEnabled` (AdminSetting). CurationItem прямо из direct-path не создаётся — идея идёт тем же triage-путём.

## Зачем

Раньше идеи терялись: сотрудник высказал на встрече — и забыли. Клиент попросил фичу — диалог ушёл в архив. Теперь:
- идея автоматически фиксируется как `Idea` (статус `captured`);
- если за неделю идею поддержали ещё 3 человека — `weight` растёт, она поднимается в /ideas;
- если идею оставили в `in_discussion` на две недели — Слой 6 спрашивает у admin'а, что с ней;
- когда статус меняется (например, `accepted` → `shipped`) — supporter'ы автоматически получают уведомление.

## Сущности

### Idea

| Поле | Тип | Значение |
|---|---|---|
| `kind` | `internal` \| `client_request` | Кто инициатор — сотрудник или клиент |
| `statement` | text | Суть одним предложением |
| `rationale` | text? | Почему так стоит |
| `weight` | Decimal(6,3) | `supporters × 1.0 + recency × 0.5 + specificity (0.5/1.0)` |
| `supporterCount` | int | Размер `supporters[]` |
| `supporters` | JSON | `[{kind:'person'|'customer', entityId, firstSupportedAt, blockId?}]` |
| `status` | IdeaStatus | captured → in_discussion → accepted → in_progress → shipped (rejected / archived) |
| `clusterId` | uuid? | Привязка к `IdeaCluster` |
| `personSubjectIds` | string[] | Для GIN-фильтра «мои идеи» (supporter) |
| `sourceBlockIds` | string[] | Какие блоки породили идею |
| `embedding` | vector(1536) | Для KNN-дедупа |

### IdeaCluster

Группа смежных идей. Создаётся `IdeaClustererCron` (раз в 4 часа): KNN cosine cluster-merge → LLM-арбитр `idea-cluster-merge`. Минимальная критическая масса — `IDEA_MIN_SUPPORTERS_FOR_CLUSTER` (default 2).

## Pipeline

```
IdeaBlock (signalType=idea|feature_request)
    │
    ▼
RouterService.dispatch → core.specialist-routing jobName='3-6-ideas'
    │
    ▼
Specialist36IdeasWorker
    │
    ▼
Specialist36Service.processBlock:
  1. KNN cosine (Idea.embedding, threshold 0.80) — match?
     → YES: update supporters / sourceBlockIds / weight (lastDiscussedAt=now).
     → NO:  LLM idea-extract → resolve supporters → create Idea (status='captured') →
            EventEmitter 'idea.created' → CurationService.triage + enqueueIdeaClusterer.
    │
    ▼ (раз в 4 часа)
IdeaClustererCron — Idea без clusterId:
  – KNN attach к существующему IdeaCluster, ИЛИ
  – LLM idea-cluster-merge на критической массе → создание нового IdeaCluster.
    │
    ▼ (при изменении статуса через REST API)
Specialist36Service.changeStatus:
  – EventEmitter 'idea.status_changed' → IdeasClosingLoopHandler:
    • LLM idea-status-summarize → {title, body}.
    • Notify supporters (person → User.id; customer → admin fallback) и автора.
```

`IdeaStatusAutoAdvanceService` (knowledge-core, `specialist-3-6.module.ts`) авто-продвигает статус идеи по событию `issue.status_changed_to_done` — задача по идее закрыта в трекере → статус идеи двигается сам (гонки с ручным изменением статуса разведены).

## REST API

| Метод | Эндпоинт | Доступ |
|---|---|---|
| GET | `/api/v1/ideas?kind=&status=&q=&clusterId=` | member (read) |
| GET | `/api/v1/ideas/:id` | member (read) |
| GET | `/api/v1/ideas/top` | member (лента с rerank) |
| GET | `/api/v1/me/ideas?role=author\|supporter` | self |
| POST | `/api/v1/ideas/:id/status` | owner/admin |
| POST | `/api/v1/ideas/:id/support` | member |
| POST | `/api/v1/me/ideas/:id/withdraw` | автор |
| POST | `/api/v1/ideas/:id/goal` | owner/admin (привязать к существующей цели — `linkGoal`) |
| POST | `/api/v1/ideas/:id/promote-to-goal` | owner/admin (принять идею → создать цель — `promoteToGoal`) |
| GET | `/api/v1/idea-clusters` | member |
| GET | `/api/v1/idea-clusters/:id` | member |

**Лента (rerank).** `GET /ideas/top` отдаёт переранжированную ленту: `ideas.service.getTop()` + `ideas-rerank.scoring.ts` со взвешенным скорингом (веса `ideas.feed.rerank.weight` / `.freshness` / `.goal_link` из AdminSetting).

## Probe-trigger'ы (Specialist 3.6)

1. **`idea.support_request`** — у только что созданной Idea единственный supporter. Кора спрашивает других members: «Поддержать?».
2. **`idea.status_unclear`** — Idea со статусом `in_discussion` уже больше 14 дней без statusChange. Кора пинает admin'а: «Что с ней решили?».

Все идут через `ProbeService.suggest(...)` (см. [[probe-agent]]). Дедуп и rate-limit делает Probe-Agent.

## UI

`/ideas` — master-detail с tabs «Внутренние / От клиентов / Мои» + status filter + поиск. Справа — detail-pane: statement, rationale, supporters, status-change buttons, кнопки «Поддержать» / «Отозвать» (для автора).

Sidebar — пункт «Идеи» в группе «Компания» (icon Lightbulb).

С «Дня компании v2» (2026-07-01, ТЗ `day-company-report-v2`) идеи подаются в дневной дайджест **кластерами** (`IdeaCluster`/`Idea.clusterId` + `supporterCount`/`weight`/`status`) — и в промпт письма COO, и одним виджетом в `DaySignalsGrid` (идеи по темам). Плоский дубль-виджет идей убран. См. [[director-dashboard]] §«День компании v2».

## Telegram

`/myideas` — top-5 идей пользователя (где он author OR supporter через personSubjectIds) со статусами на русском.

## ENV

```
IDEA_CLUSTER_THRESHOLD=0.80
IDEA_CLUSTERER_CRON="30 */4 * * *"
IDEA_MIN_SUPPORTERS_FOR_CLUSTER=2
```

> Пороги идей — крутилки **AdminSetting** (`knowledge.ideaClusterThreshold` / `knowledge.ideaMinSupportersForCluster` / `knowledge.ideasExtractMinConfidence`, плюс `ideas.feed.rerank.*`), резолв через `getDynamic` (admin→ENV→code-fallback); ENV выше — только code-fallback. Реестр — `admin-setting-schema-registry.ts`.

## Метрики

- `core_specialist_pipeline_duration_seconds{type='idea'}`
- `core_specialist_cards_total{type='idea', status}`
- `core_specialist_llm_tokens_total{type='idea', model, tier}`
- `idea_status_change_notifications_total{new_status}` — closing-loop.

## Что отложено

- Полный customer-closing-loop через `Customer.responsibleUserId` — Customer-модели как таблицы в Z нет (только Entity{type=customer}), fallback на admin.
- Аналитика adoption «сколько % shipped идей сотрудников» — γ+.

## См. также

- [[probe-agent]] — без него идеи превращаются в кладбище.
- [[goals-and-strategic-alignment]] — `Idea.goalId` + `POST /ideas/:id/goal` / `/promote-to-goal`: мост «гипотеза → цель».
- [[../02_architecture/module-map|02_architecture/module-map.md]] — раздел «SBA β-5».
