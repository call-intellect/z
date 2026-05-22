---
type: project
status: active
phase: beta-5
updated: 2026-05-22
related:
  - 02_architecture/module-map.md (β-5)
  - 01_projects/probe-agent.md
  - plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md
---

# Specialist 3.6 — Ideas Collector

Шестой специалист Слоя 3. Превращает блоки `signalType ∈ {idea, feature_request}` в структурированные карточки `Idea` с поддерживающими, динамическим весом и статусом.

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

## REST API

| Метод | Эндпоинт | Доступ |
|---|---|---|
| GET | `/api/v1/ideas?kind=&status=&q=&clusterId=` | member (read) |
| GET | `/api/v1/ideas/:id` | member (read) |
| GET | `/api/v1/me/ideas?role=author\|supporter` | self |
| POST | `/api/v1/ideas/:id/status` | owner/admin |
| POST | `/api/v1/ideas/:id/support` | member |
| POST | `/api/v1/me/ideas/:id/withdraw` | автор |
| GET | `/api/v1/idea-clusters` | member |
| GET | `/api/v1/idea-clusters/:id` | member |

## Probe-trigger'ы (Specialist 3.6)

1. **`idea.support_request`** — у только что созданной Idea единственный supporter. Кора спрашивает других members: «Поддержать?».
2. **`idea.status_unclear`** — Idea со статусом `in_discussion` уже больше 14 дней без statusChange. Кора пинает admin'а: «Что с ней решили?».

Все идут через `ProbeService.suggest(...)` (см. [[probe-agent]]). Дедуп и rate-limit делает Probe-Agent.

## UI

`/ideas` — master-detail с tabs «Внутренние / От клиентов / Мои» + status filter + поиск. Справа — detail-pane: statement, rationale, supporters, status-change buttons, кнопки «Поддержать» / «Отозвать» (для автора).

Sidebar — пункт «Идеи» в группе «Компания» (icon Lightbulb).

## Telegram

`/myideas` — top-5 идей пользователя (где он author OR supporter через personSubjectIds) со статусами на русском.

## ENV

```
IDEA_CLUSTER_THRESHOLD=0.80
IDEA_CLUSTERER_CRON="30 */4 * * *"
IDEA_MIN_SUPPORTERS_FOR_CLUSTER=2
```

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
- [[../02_architecture/module-map|02_architecture/module-map.md]] — раздел «SBA β-5».
