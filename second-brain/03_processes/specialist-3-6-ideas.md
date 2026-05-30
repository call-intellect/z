---
name: specialist-3-6-ideas
title: Сбор идей сотрудников и запросов клиентов (специалист 3-6)
trigger_type: event
status_overall: partial
last_audited: 2026-05-29
owners_human:
  - продакт «второго мозга»
  - инженер knowledge-core
related_plans:
  - plans/tz/2026-05-21-second-brain-agents-umbrella.md
  - plans/tz/2026-05-21-sba-beta-5-specialist-3-6-ideas-and-layer6-probe.md
  - plans/tz/2026-05-22-final-roadmap.md
related_projects:
  - 01_projects/ideas.md
  - 01_projects/probe-agent.md
  - 01_projects/conversational-channels.md
---

# Сбор идей сотрудников и запросов клиентов

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

В каждой компании идеи рождаются хаотично: на встрече кто-то говорит «давайте сделаем X», в переписке клиент пишет «вот бы у вас была функция Y», в чате коллега бросает «придумал, как ускорить процесс Z». Обычно эти предложения улетают в небытие: переговоры закончились, чат прокрутился, фокус сместился. Через месяц та же идея снова всплывает у другого человека — и снова уходит в никуда.

Z ловит каждое такое предложение. Платформа сама разбирает встречи, заметки и сообщения и выделяет всё, что выглядит как идея сотрудника или запрос клиента. Дальше она группирует одинаковые по смыслу предложения в один «кластер»: если три разных клиента просят одну и ту же фичу — это становится одной карточкой с тремя поддерживающими. У каждой идеи есть «вес» — сколько людей её поддержали, насколько недавно она обсуждалась, насколько конкретно она сформулирована.

У идеи свой жизненный цикл: появилась → обсуждается → принята → в работе → выпущена (или отклонена / архивирована). Когда статус меняется на «выпущена» или «отклонена», платформа сама пишет коротким текстом, что в итоге решили, и шлёт это всем поддержавшим — закрывает петлю. Если у идеи нашлась только одна поддержка и больше две недели ничего не меняется — платформа пинает админа: «что с ней делать?».

На странице `/ideas` есть три вкладки: «Внутренние», «От клиентов», «Мои» — где можно отфильтровать по статусу, поискать, посмотреть кластера, и тут же поддержать идею или отозвать свою.

## 2. Что запускает (триггер)

- **Тип:** событие в графе знаний + регулярная кластеризация + событие смены статуса.
- **Что инициирует:**
  1. Новый `IdeaBlock` со `signalType ∈ {idea, feature_request}` (его уже добавил общий конвейер `core.raw-events`).
  2. Каждые 4 часа — `IdeaClustererCron` ищет одиночные идеи, кластеризует их.
  3. Изменение статуса идеи через REST API — `EventEmitter` шлёт `idea.status_changed`, closing-loop handler шлёт уведомления supporter'ам.
- **Технический источник:**
  - очередь `core.specialist-routing`, jobName=`3-6-ideas` — для нового блока,
  - cron `30 */4 * * *` (`IdeaClustererCron`) — кластеризация,
  - событие EventEmitter `idea.status_changed` → `IdeasClosingLoopHandler` — closing-loop.

## 3. Шаги процесса (общий список)

1. **Платформа получает новый блок-идею** (внутреннее предложение или запрос клиента).
2. **Ищет похожую идею среди существующих** — по смыслу (KNN-поиск по embedding).
3. **Если похожая есть** — добавляет нового supporter'а, пересчитывает supporterCount, weight, дату последнего обсуждения.
4. **Если похожей нет** — LLM-извлечение создаёт новую `Idea` (статус `captured`), эмиттит `idea.created`, ставит в очередь кластеризатора.
5. **Раз в 4 часа** кластеризатор группирует одиночные идеи в `IdeaCluster` (KNN cosine 0.80; на miss — LLM-арбитр `idea-cluster-merge`, требуется ≥ 2 поддерживающих для нового кластера).
6. **Сотрудник заходит на `/ideas`** и видит вкладки «Все / По кластерам / Мои», может поддержать, отозвать, изменить статус (только owner/admin).
7. **При смене статуса** платформа эмиттит `idea.status_changed`, LLM пишет короткое саммари «что решили», closing-loop рассылает уведомления supporter'ам и автору.

## 4. Что получается на выходе

- **Кому:** автору идеи, supporter'ам, owner/admin (для изменения статуса), member (read).
- **В каком виде:** запись `Idea` в БД, `IdeaCluster` (кластер смежных), in-app/Telegram уведомления при closing-loop, probe-уведомления при `idea.support_request` и `idea.status_unclear`.
- **Где это видно:**
  - `/ideas` — master-detail с вкладками «Все / По кластерам / Мои»,
  - sidebar — пункт «Идеи» (icon Lightbulb).

## 5. Технический разрез (по шагам)

| # | Шаг (бытовой) | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Новый блок-идея | RouterService.dispatch ставит job в `core.specialist-routing` jobName=`3-6-ideas` после canonical для `signalType ∈ {idea, feature_request}` | `backend/src/modules/knowledge-core/workers/specialist-3-6-ideas.worker.ts:30`, `router.service.ts` | `core.specialist-routing` (jobName=`3-6-ideas`) | — (читает `IdeaBlock`) | ✅ |
| 2 | Поиск похожей идеи | KNN cosine по `Idea.embedding` той же Org с порогом `cfg.ideas.clusterThreshold` (0.80) | `backend/src/modules/knowledge-core/services/specialist-3-6-ideas.service.ts` (метод `processBlock`) | внутри worker | — | ✅ |
| 3 | Идея найдена — обновляем | supporters.push, supporterCount += 1, weight = `supporters × 1.0 + recency × 0.5 + specificity (0.5/1.0)`, lastDiscussedAt=now | `specialist-3-6-ideas.service.ts` | — | `Idea.supporters`, `supporterCount`, `weight`, `sourceBlockIds`, `lastDiscussedAt` | ✅ |
| 4 | Идея новая — создаём | LLM `idea-extract` → черновик; резолв supporters (kind:'person' → User.id, kind:'customer' → admin fallback); EventEmitter `idea.created` → `CurationService.triage` + `enqueueIdeaClusterer` | `specialist-3-6-ideas.service.ts`, `backend/src/modules/knowledge-core/prompts/idea-extract.prompt.ts` | LLM `idea-extract` | `Idea` (новая запись, `status='captured'`) | ✅ |
| 5 | Кластеризация (cron) | Раз в 4 часа `IdeaClustererCron.sweep`: ищет Idea без `clusterId`, KNN-присоединение к existing `IdeaCluster` (порог 0.80); при miss собирает партию ≥ `cfg.ideas.minSupportersForCluster` (2) и вызывает LLM `idea-cluster-merge` (verdict: `new_cluster / add_to_existing / standalone`); пересчёт `clusterWeight` и embedding кластера | `backend/src/modules/knowledge-core/workers/idea-clusterer.cron.ts:48` | `@Cron('30 */4 * * *')` | `IdeaCluster`, `Idea.clusterId` | ✅ |
| 6 | UI и API | `/ideas` master-detail с вкладками; REST `/api/v1/ideas`, `/me/ideas`, `/idea-clusters` | `backend/src/modules/ideas/ideas.controller.ts:60`, `frontend/app/(authenticated)/ideas/IdeasListClient.tsx:52` | `GET /api/v1/ideas`, `/ideas/:id`, `/me/ideas`, `POST /ideas/:id/status`, `/support`, `/me/ideas/:id/withdraw`, `GET /idea-clusters` | — | ✅ |
| 7 | Closing-loop по смене статуса | REST `POST /api/v1/ideas/:id/status` → `Specialist36Service.changeStatus` → EventEmitter `idea.status_changed` → `IdeasClosingLoopHandler` → LLM `idea-status-summarize` → notification supporter'ам и автору | `specialist-3-6-ideas.service.ts`, `backend/src/modules/knowledge-core/services/ideas-closing-loop.handler.ts`, `backend/src/modules/knowledge-core/prompts/idea-status-summarize.prompt.ts` | `EventEmitter` `idea.status_changed`, LLM `idea-status-summarize`, `conversational.send` | `Notification`, `Idea.statusChangedAt`, `statusChangedByUserId`, `statusReason` | ✅ |
| 8 | Probe-trigger'ы | `idea.support_request` (новая Idea, единственный supporter) → пингуем others member'ов «поддержать?»; `idea.status_unclear` (`status='in_discussion'` > 14 дней без statusChange) → пингуем admin | `specialist-3-6-ideas.service.ts`, `backend/src/modules/knowledge-core/services/specialist-3-6-probe.service.ts` | через `ProbeService.suggest` → `core.probe-events` | `ProbeEvent` | ✅ |
| 9 | Telegram-команда `/myideas` | По ТЗ — top-5 идей пользователя через Telegram. **В коде не реализована**: `TelegramBotAdapter` сейчас принимает только `/login` как slash-команду (см. `telegram-bot.adapter.ts:90,117` — «единственная допустимая slash-команда»). | — (отсутствует в Telegram-боте) | — | — | ❌ только в ТЗ |

### 5.1 Структуры данных, через которые проходит процесс

```
IdeaBlock (signalType ∈ {idea, feature_request}, status='canonical')
  ↓ RouterService.dispatch → core.specialist-routing jobName='3-6-ideas'
Idea (kind: internal | client_request, statement, rationale, weight,
      supporters JSON, supporterCount, status: captured → in_discussion →
      accepted → in_progress → shipped (rejected / archived), embedding)
  ↓ IdeaClustererCron (cron 30 */4 * * *)
IdeaCluster (name, description, ideaIds[], clusterWeight, embedding)
  ↓ REST POST /ideas/:id/status → EventEmitter 'idea.status_changed'
LLM idea-status-summarize → Notification (in-app + Telegram) supporter'ам и автору
```

Модель `Idea` — `schema.prisma:5253` (индексы по `(tenantId, status, kind)`, `(tenantId, weight)`, `(tenantId, createdByUserId)`, `(tenantId, clusterId)`). `IdeaCluster` — `schema.prisma:5302`. Enum'ы `IdeaKind` (:5211), `IdeaStatus` (:5219).

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где промпт |
|---|---|---|---|---|
| 4 | `idea-extract` | DeepSeek V4 Flash | OpenAI mini → Ollama | `backend/src/modules/knowledge-core/prompts/idea-extract.prompt.ts` |
| 5 | `idea-cluster-merge` | DeepSeek V4 Flash | OpenAI mini → Ollama | `backend/src/modules/knowledge-core/prompts/idea-cluster-merge.prompt.ts` |
| 7 | `idea-status-summarize` | DeepSeek V4 Flash | OpenAI mini → Ollama | `backend/src/modules/knowledge-core/prompts/idea-status-summarize.prompt.ts` |

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `core_specialist_pipeline_duration_seconds{type='idea'}` — длительность.
- `core_specialist_cards_total{type='idea', status}` — статистика.
- `core_specialist_llm_tokens_total{type='idea', model, tier}` — расход.
- `idea_status_change_notifications_total{new_status}` — closing-loop отправки.

**BullMQ очереди:**
- `core.specialist-routing` (jobName=`3-6-ideas`).
- `core.probe-events`.
- `conversational.send` — closing-loop уведомления.

**Логи:** `Specialist36IdeasWorker`, `Specialist36Service`, `IdeaClustererCron`, `IdeasClosingLoopHandler`. Контекст — `blockId`, `tenantId`, `ideaId`, `clusterId`.

**Известные грабли:**
- `@Cron` зашит литералом `'30 */4 * * *'`; ENV `IDEA_CLUSTERER_CRON` декларирован в `env.schema.ts`, но не подхватывается (см. NB-комментарий аналогично insight-clusterer).
- Кластеризатор требует ≥ 2 одиночных идей для создания нового кластера. На пустой Org с одной новой идеей — кластер не создаётся, она ждёт следующего прохода.
- Закрытие петли (`idea.status_changed`) для customer-поддерживающих идёт через admin fallback — модели `Customer` с `responsibleUserId` в Z нет, только Entity{type=customer} (см. `01_projects/ideas.md` «Что отложено»).

**Кнопки админки:** `/admin/curation` (review для critical), `/admin/platform/workers` (повторить упавший job).

## 7. Связанные процессы

- [[meeting-post-processing]] — главный источник `IdeaBlock` с `signalType=idea|feature_request` (Шаг 7б).
- [[raw-event-to-graph]] — общий конвейер блоков (Шаг 1 здесь — выход оттуда).
- [[probe-question-flow]] — 2 probe-trigger'а отсюда (`idea.support_request`, `idea.status_unclear`).
- [[notification-dispatch]] — closing-loop уведомления supporter'ам и автору при `idea.status_changed`.

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ и реализовано без расхождений:**
- KNN-кластеризация с порогом 0.80, LLM-арбитр `idea-cluster-merge`, минимальный размер кластера = 2 — всё на месте (`idea-clusterer.cron.ts:103-260`).
- Closing-loop через EventEmitter `idea.status_changed` → LLM `idea-status-summarize` → notification supporter'ам — реализован (`ideas-closing-loop.handler.ts`).
- 2 probe-trigger'а (`idea.support_request`, `idea.status_unclear`) — реализованы.

**Заложено в ТЗ, не реализовано (расхождение с задачей):**
- **Telegram-команда `/myideas`** — в задаче и в `01_projects/ideas.md` указано «теперь функциональна», но в коде `TelegramBotAdapter` принимает только `/login` (см. `telegram-bot.adapter.ts:90,117,607-650`). В `TelegramBotMessageHandler` нет ветки `/myideas`. Команда либо отвалилась при ripout zero-button (`plans/archive/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md`), либо не доведена до прода. Требует возврата.

**Реализовано иначе:**
- `IDEA_CLUSTERER_CRON` ENV декларирован, но `@Cron` принимает только литерал — то же ограничение, что у insight-clusterer.
- Customer-closing-loop через `Customer.responsibleUserId` не реализован — fallback на admin (заявлено в `01_projects/ideas.md`).

**Отложено:**
- Аналитика adoption «сколько % shipped идей от сотрудников» — γ+.
- Полная customer-модель — γ+ (сейчас Entity{type=customer}).

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-23 | Ripout Telegram-кнопок (zero-button) — `/myideas` пропала вместе с inline-keyboard'ом | `plans/archive/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md` |
| 2026-05-21 | Запуск β-5 — Specialist 3.6 | `01_projects/ideas.md` |
