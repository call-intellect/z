---
type: tz
status: done
feature: Ленты активности Z/Кора — вопросы Probe Agent, инсайты, решения, задачи, идеи, конфликты на дашборде
date: 2026-05-23
parent: plans/analysis/2026-05-23-product-overview-simple.md
related:
  - plans/tz/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md
  - plans/tz/2026-05-23-sba-beta-5-closing-loop-respond-to-probe.md
---

# Ленты активности — sub-ТЗ

## TL;DR

Единая модель `ActivityFeedItem` — живой поток событий от агентов и системы. На дашбордах CEO/COO/руководителя/сотрудника появляются 6 типов лент: **вопросы от Probe Agent**, **инсайты**, **решения**, **задачи команды**, **идеи**, **конфликты**. Лента вопросов критична: показывает кто/когда отвечал на вопросы агентов — прозрачность и контроль. **Публичная лента инсайтов** — все видят что находят коллеги, это вдохновляет и снимает информационный пузырь. Срок: 4 человеко-недели (входит в Фазу 6 трекера / параллельно с β-8).

## Зачем это нужно

Сейчас агенты Z/Коры работают «в тёмную»:
- Probe Agent задал вопрос Иванову через Telegram — никто кроме Иванова и самого агента не знает что произошло.
- Insights Radar нашёл новую повторяющуюся проблему — она лежит в БД, на дашборде среди прочих 100.
- Decisions Registry заметил отмену решения — нигде это не показано.

**Лента активности — это live-канал между агентами и людьми**, который делает работу агентов видимой и встраивает её в ежедневную рутину команды.

## Модель данных

### ActivityFeedItem (единая модель)

```
model ActivityFeedItem {
  id              String   @id @default(cuid())
  tenantId        String
  
  // Тип ленты
  feedType        String              // probe_question | insight | decision | task | idea | conflict | knowledge_change
  
  // Источник события
  sourceType      String              // ai_agent | system | user
  sourceAgentName String?             // 'probe_agent' | 'insights_radar' | 'decisions_registry' | ...
  sourceUserId    String?
  
  // Связанные сущности
  relatedEntityType String?           // probe_event | insight | decision | issue | idea | conflict_item
  relatedEntityId   String?
  
  // Контент для отображения
  title           String              // короткая строка
  summary         String?  @db.Text   // расшифровка
  iconType        String?             // question | bulb | check | warning | flame
  severity        String?  @default("normal") // critical | high | normal | low
  
  // Статус (для probe_question — отправлен/доставлен/прочитан/отвечен)
  status          String              // emitted | delivered | seen | responded | actioned | dismissed | expired
  
  // Кому видна
  visibility      String              // public_org | team | role | private
  visibilityScope Json?               // { teamIds: [], roleIds: [], userIds: [] } если scope узкий
  
  // Кто адресат (для probe_question — целевой человек)
  targetUserId    String?
  targetChannel   String?             // in_app | telegram | email | mobile_push
  
  // Привязка к команде / проекту / цели для фильтров
  teamId          String?
  projectId       String?
  goalId          String?
  
  // Для лидерборда / геймификации
  reactions       Json?               // { thanks: [userId, ...], votes: [userId, ...] }
  
  // Срок жизни
  expiresAt       DateTime?           // probe-вопросы истекают через 24-72 часа
  
  // Аналитика
  emittedAt       DateTime @default(now())
  deliveredAt     DateTime?
  seenAt          DateTime?
  respondedAt     DateTime?
  actionedAt      DateTime?
  
  @@index([tenantId, feedType, emittedAt])
  @@index([tenantId, targetUserId, status])
  @@index([tenantId, teamId, emittedAt])
  @@index([tenantId, visibility, emittedAt])
}
```

### ActivityFeedSubscription (на что подписан пользователь)

```
model ActivityFeedSubscription {
  id          String   @id @default(cuid())
  userId      String
  feedType    String
  filters     Json                    // { teamIds, projectIds, severities, ... }
  digestMode  String   @default("realtime") // realtime | daily_digest | weekly_digest | off
  channels    String[] @default(["in_app"])
  createdAt   DateTime @default(now())
  
  @@unique([userId, feedType])
}
```

## 6 типов лент — что в каждой

### 1. Лента вопросов от Probe Agent

**Что:** все вопросы, которые AI-агенты задают людям через каналы.

**Статусы:**
- 🔵 `emitted` — агент сформулировал вопрос
- 📩 `delivered` — отправлен в канал (Telegram/email/in-app), доставлен
- 👁 `seen` — пользователь прочитал
- ✅ `responded` — ответил, AI обработал
- ⏰ `expired` — прошло 24-72 часа без ответа
- 🚫 `dismissed` — пользователь нажал «не отвечу»

**Кто видит:**
- **Целевой пользователь** — свои входящие вопросы.
- **Руководитель команды** — все вопросы к членам команды (видит исполнение).
- **Главный администратор** — все вопросы организации.
- **Сам Probe Agent** (внутренний админ-дашборд) — engagement_rate, какой канал работает лучше, какие формулировки игнорируются.

**Зачем:**
- Прозрачность работы AI.
- Контроль: руководитель видит игнорирует ли кто-то AI-вопросы.
- Качество промптов: если 30% вопросов dismissed — формулировки плохие.
- Связь Probe Agent → β-5 Closing-Loop (когда вопрос отвечен — закрывается петля).

### 2. Лента инсайтов (от Insights Radar β-4) — **публичная**

**Что:** новые повторяющиеся проблемы, риски, блокеры с динамикой (spike/growing/stable/declining).

**Видимость:**
- **Публичная** — `visibility='public_org'` — все сотрудники видят инсайты команды (за исключением insights с `sensitivity='restricted'`, например HR-инциденты).
- Это **вдохновляет**: «у соседней команды такая же проблема, я её решил месяц назад — поделюсь».
- Снимает информационный пузырь.

**Что в карточке:**
- Заголовок инсайта (от LLM)
- Динамика: 🔥 растёт / 📊 стабильно / 📉 спадает / ⚡ новое
- Severity: critical / high / normal / low
- Кого затронуло: 3-5 человек или «команда А»
- Сколько раз встречалось / за какой период
- Кнопка «полезно» / «спасибо» (реакции — для геймификации)
- Связанные решения, регламенты

### 3. Лента решений (от Decisions Registry β-3)

**Что:** новые решения, изменения статуса, supersede-цепочки.

**Видимость:** `team` или `public_org` в зависимости от `Decision.dataClass`.

**События:**
- Новое решение принято (из встречи / переписки)
- Решение отменено (`status='cancelled'`)
- Решение заменено другим (`supersededBy` link)
- Дедлайн решения прошёл, результат не подтверждён (от cron)
- Конфликт двух решений — нужно куратору

### 4. Лента задач команды

**Что:** что сегодня происходит с задачами команды.

**Видимость:** `team` — только участники проектов команды.

**События:**
- Новая задача создана / назначена
- Задача завершена
- Задача заблокирована (`task_blocked`)
- Просроченная задача
- Упоминание в комментарии
- Привязка к цели

### 5. Лента идей (от Ideas Collector β-5)

**Что:** новые идеи от сотрудников и запросы от клиентов.

**Видимость:** `public_org` для внутренних идей, `team` для клиентских (зависит от настройки).

**События:**
- Новая идея от сотрудника / клиента
- Идея набрала >N поддерживающих (порог)
- Кластер похожих идей создан (от IdeaClustererCron)
- Изменение статуса: captured → in_review → in_development → shipped / rejected
- **Геймификация**: когда идея переходит в `in_development` — автор получает ⭐ в свой профиль (см. отдельное sub-ТЗ Геймификации).

### 6. Лента конфликтов (от Curation Layer α-4)

**Что:** когда AI обнаружил противоречие — два регламента, две версии одного решения, противоречивые знания.

**Видимость:** `role='curator'` — назначенный куратор по теме.

**События:**
- Новый конфликт ждёт разрешения
- Конфликт разрешён (как: merge / replace / evolving / dismiss)
- Конфликт эскалирован

### 7. (бонус) Лента изменений знаний

**Что:** изменения в графе знаний компании, которые касаются конкретного пользователя.

**Видимость:** `private` — только тот, кого изменения касаются.

**События:**
- Добавлена новая черта в твой клон знаний / навыков
- Удалена черта (после `mark_as_misleading`)
- Появилась новая роль / должность в твоей карте
- AI «пересобрал» твой профиль знаний

## REST API

```
GET    /api/v1/feed                       # лента текущего пользователя (агрегат по подпискам)
GET    /api/v1/feed/probe-questions       # отдельная лента вопросов
GET    /api/v1/feed/insights              # публичная лента инсайтов
GET    /api/v1/feed/decisions
GET    /api/v1/feed/team-tasks
GET    /api/v1/feed/ideas
GET    /api/v1/feed/knowledge-changes     # private — изменения в моём профиле

POST   /api/v1/feed/:itemId/react         # реакция: thanks | vote
POST   /api/v1/feed/:itemId/dismiss       # скрыть из своей ленты
GET    /api/v1/feed/subscriptions
PATCH  /api/v1/feed/subscriptions/:type   # настройки подписки
```

### Фильтры в каждой ленте

- По типу события
- По severity
- По команде / проекту / цели
- По временному окну (сегодня / неделя / месяц)
- По статусу (для probe-вопросов — отвеченные / неотвеченные)
- По агенту-источнику

## WebSocket events

```
feed.new_item                  # новое событие в любой ленте, к которой подписан
feed.item_updated              # обновление статуса (например, probe responded)
feed.item_dismissed
```

## Frontend компонент

**`<ActivityFeedWidget>`** — встраиваемый виджет на любом дашборде:

```tsx
<ActivityFeedWidget
  feedTypes={["probe_question", "insight"]}
  scope="team"
  teamId={currentTeamId}
  pageSize={20}
  liveUpdate
/>
```

**Страницы:**
- `/feed` — единая лента (все подписки пользователя)
- `/feed/probe-questions` — только вопросы (целевая аудитория: руководители, Probe Agent admin)
- `/feed/insights` — публичные инсайты (вдохновляющая лента для всех)
- `/dashboard` — встроены виджеты лент по ролям

### Виджеты на разных дашбордах

| Дашборд | Какие ленты встроены |
|---|---|
| **CEO Dashboard** | Probe-вопросы по компании (компактно), критические инсайты, новые решения, конфликты |
| **COO Operations Dashboard (β-8)** | Probe-вопросы команды, инсайты, задачи дня, идеи |
| **Руководитель команды** | Probe-вопросы своей команды, инсайты команды, задачи команды, идеи команды |
| **Член команды (`/dashboard` или `/me`)** | Свои probe-вопросы, публичные инсайты, изменения в моём профиле, мои идеи |
| **Probe Agent admin (`/admin/probe`)** | Все вопросы со статусами, engagement_rate, формулировки-проблемы |

## Заполнение ленты

### EventEmitter паттерн

Каждый агент эмитит событие в `feed.item.created`:

```typescript
// В Probe Agent:
await this.activityFeedService.publish({
  feedType: 'probe_question',
  sourceType: 'ai_agent',
  sourceAgentName: 'probe_agent',
  relatedEntityType: 'probe_event',
  relatedEntityId: probeEvent.id,
  title: probeEvent.formulatedQuestion,
  status: 'emitted',
  visibility: 'private',
  targetUserId: probeEvent.targetUserId,
  targetChannel: probeEvent.channel,
  expiresAt: probeEvent.expiresAt,
  severity: probeEvent.priority,
});
```

В аналогичных местах:
- Insights Radar — `feed.publish({ feedType: 'insight', ...})`
- Decisions Registry — `feed.publish({ feedType: 'decision', ...})`
- Issue/Cycle events — `feed.publish({ feedType: 'task', ...})`
- Ideas Collector — `feed.publish({ feedType: 'idea', ...})`
- Curation Service — `feed.publish({ feedType: 'conflict', ...})`

### Cron-задачи

- **`ActivityFeedExpireCron`** (раз в час) — помечает старые `probe_question` как `expired`.
- **`ActivityFeedDigestCron`** (раз в день/неделю) — собирает дайджесты для подписчиков `digestMode='daily/weekly_digest'`.

## RBAC

Новый ResourceType `activity_feed_item`:
- read: scope по `visibility` (public_org/team/role/private)
- write: только система и AI-агенты (не пользователи напрямую)
- react: любой member (для thanks/vote)
- dismiss: только себе

## Связь с β-5 Closing-Loop

Когда `notification.responded` приходит для probe-question:
- ActivityFeedItem статус → `responded`
- Сам probe_event → handled
- Запускается LLM `idea-status-summarize` или другой обработчик ответа
- В ленте появляется второе событие: «ответ обработан, что AI сделал».

## Геймификация (отдельное sub-ТЗ, но интеграция здесь)

- Реакции `thanks` на ленту инсайтов и идей — это мини-награды.
- Когда идея пользователя переходит `in_development` — `ActivityFeedItem` для автора с `feedType='knowledge_change'` и наградой.
- Лидерборд «топ-10 идей за месяц», «топ-помощники» — отдельные виджеты, опирающиеся на агрегаты по ленте.

(Детальное sub-ТЗ — [2026-05-23-gamification-and-motivation.md](2026-05-23-gamification-and-motivation.md))

## Метрики Prometheus

```
feed_items_total{tenant, feed_type, source_agent}
feed_items_responded_total{tenant, feed_type}
feed_items_dismissed_total{tenant, feed_type}
feed_engagement_rate{tenant, agent}           # отвечено / эмитировано
feed_websocket_clients{tenant}
```

## DoD

- [x] Модели `ActivityFeedItem` + `ActivityFeedSubscription` в Prisma
- [x] `ActivityFeedService.publish()` — единая точка входа для всех агентов
- [x] 6 типов лент работают: probe-questions / insights / decisions / tasks / ideas / conflicts
- [x] REST endpoints с фильтрами и пагинацией
- [x] WebSocket live-update
- [x] Frontend компонент `<ActivityFeedWidget>` встраивается на дашборды
- [x] Все агенты (Probe / Insights Radar / Decisions Registry / Issue Module / Ideas Collector / Curation) публикуют в ленту
- [x] Cron-задачи: expire, digest
- [x] RBAC ResourceType + visibility-scope работают
- [x] Метрики Prometheus экспортируются
- [x] Тесты: unit + integration + e2e (Playwright — открыть `/feed`, увидеть события)

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- Модели `ActivityFeedItem` (schema.prisma:6636) + `ActivityFeedSubscription` (рядом).
- `ActivityFeedModule` (@Global) в `backend/src/modules/activity-feed/`: `ActivityFeedService.publish()`, `ActivityFeedGateway` (WebSocket `/ws/feed`), 2 контроллера (feed + feed-subscriptions).
- Cron'ы: `feed-expire.cron.ts` (каждые 15 мин) + `feed-digest.cron.ts` (daily/weekly).
- Frontend: `/feed`, `/feed/spotlights`, `/feed/insights`, `/feed/probe-questions` страницы.
- RBAC `activity_feed_item` ResourceType (policy.csv:779-785).
- Spec'и: `activity-feed.service.spec.ts` + `feed.controller.spec.ts`.
- Wave 2 finishing (commit 1a35a38) — Recognition → ActivityFeed publish bridge через `recognition-formulate.worker.ts`.

## Срок

**4 человеко-недели** (можно параллельно с Фазой 6 трекера / β-8 COO Dashboard).

---

_2026-05-23: лента активности — критическая фича для видимости работы AI-агентов и для культуры обмена знаниями (публичные инсайты)._
