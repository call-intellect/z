---
type: tz
status: partial
feature: Геймификация и мотивация Z/Кора — поощрения за идеи, помощь, чек-ины; мягкое признание без жёстких рейтингов
date: 2026-05-23
parent: plans/analysis/2026-05-23-product-overview-simple.md
related:
  - plans/tz/2026-05-23-activity-feeds.md
  - plans/tz/2026-05-23-sba-beta-5-closing-loop-respond-to-probe.md
  - second-brain/01_projects/ideas.md
---

# Геймификация и мотивация — sub-ТЗ

## TL;DR

Платформа замечает и публично отмечает: чьи идеи взяли в работу, кто помог коллегам, кто стабильно делает чек-ины. Никаких жёстких рейтингов «лучший vs худший» (это конфликтогенно в РФ-культуре) — только **мягкое позитивное признание**. AI-агент «Благодарностей» отправляет «коллеги ценят» сообщения. На дашбордах появляются мини-блоки «вклад в команду». Это **встраивается во всё что мы строим**: чек-ины, идеи, чат-в-задаче, лента инсайтов. Срок: 3 человеко-недели.

## Зачем это нужно

Z/Кора собирает данные **самой ценностью которого является участие людей**. Если сотрудники не делают чек-ины, не пишут в чате задач, не предлагают идеи — у системы нет материала для второго мозга. Мотивация участвовать — **техническое требование**, не маркетинг.

**Главные мотиваторы по поведенческой экономике:**
1. **Признание видимое коллегам** > денежная премия (для офисных задач).
2. **Прогресс виден сразу** > отложенная награда раз в квартал.
3. **Связь действия с результатом** («моя идея в работе») > абстрактные KPI.

## Что НЕ делаем (anti-patterns)

- **Жёсткие рейтинги «топ-1 продавец»** — конфликты, токсичность, накрутка.
- **Очки/баллы как валюта** — превращает работу в игру, обесценивает.
- **Публичный позор за неактивность** («Иванов не делал чек-ин 5 дней») — наоборот демотивирует.
- **Соревновательные лидерборды по производительности** — поощряют выгорание.
- **Геймификация как самоцель** — должна работать незаметно.

## Что делаем

### 1. Признание за идеи, которые «пошли в работу»

**Триггер:** `Idea.status` меняется с `captured` или `in_review` на `in_development` или `shipped`.

**Что происходит:**
- В ленте идей появляется событие «Идея Иванова «X» взята в разработку».
- Автор получает уведомление через свой канал: «Твоя идея «X» теперь в работе. Спасибо за инициативу!»
- На странице `/me/contributions` добавляется отметка.
- В профиле автора в карте команды появляется небольшая отметка-бейдж 💡 «N идей в работе».
- Если идея `shipped` — повторное уведомление с ссылкой на результат.

**Без шкалы «лучший идеатор» — только индивидуальный позитивный сигнал.**

### 2. Признание за помощь коллегам

**Триггеры:**
- Кнопка «Спасибо» в комментарии к задаче / в чате-в-задаче.
- Кнопка «Полезно» на инсайте / решении / регламенте.
- Упоминание в чек-ине «мне помог Иванов» — AI извлекает (`signalType='helped_by'` в новом расширении α-2).
- Когда сотрудник отвечает на probe-вопрос коллеге.

**Что происходит:**
- В профиле помощника увеличивается счётчик «полученных спасибо» (но не показывается публично топ-списком).
- Раз в неделю AI-агент «Благодарностей» (см. ниже) отправляет помощнику сводку: «На этой неделе тебя поблагодарили N раз. Коллеги ценят».
- Никаких очков, никакого магазина наград.

### 3. Стрики чек-инов (streaks)

**Триггер:** N дней подряд сотрудник делает утренние и вечерние чек-ины.

**Что происходит:**
- На странице «Мои чек-ины» появляется ненавязчивая отметка «7 дней подряд — спасибо, ты помогаешь команде видеть полную картину».
- На 30-й день — отдельное «спасибо» с упоминанием для руководителя (тоже мягко: «Иванов 30 дней подряд, надёжный канал»).
- **Никаких штрафов за прерывание стрика.** Прервал — начинает заново, без негатива.

### 4. AI-агент «Благодарностей» (Recognition Agent)

**Новый агент** (расширение Слоя 6 — после Probe Agent).

**Что делает:**
- Раз в неделю (`@Cron('0 9 * * MON')`) проходит по всем тенантам.
- Для каждого сотрудника собирает: полученные `thanks`, упоминания «помог», отзывы на работу, идеи в работе.
- Если есть значимый вклад — формулирует благодарственное сообщение через LLM (`recognition-formulate` taskType):
  > «На этой неделе ты помог 4 коллегам по вопросам безопасности. Иван отдельно отметил твою помощь по конфигурации. Спасибо, что делишься экспертизой.»
- Отправляет через предпочитаемый канал.
- **Не шлёт пустых благодарностей** — если вклад незначительный, ничего не пишет (лучше тишина, чем формальность).

**LlmTaskType `recognition-formulate`:**
- Primary: DeepSeek (через proxy.agent-lia.ru)
- Secondary: OpenAI gpt-4o-mini (через proxy.agent-lia.ru)
- Tertiary: Ollama qwen3.5:9b

### 5. Командные «Spotlights» — индивидуально, не сравнительно

Раз в неделю на COO-дашборде и в виджете руководителя появляется блок:

**«Команда на этой неделе»**
- 💡 3 новые идеи от сотрудников (с именами)
- 🤝 12 случаев взаимопомощи (анонимизировано: «Иван помог Петру с X, Алла помогла Никите с Y», без рейтинга)
- ✅ 28 задач завершено
- 📊 Настроение команды: 75% зелёных дней / 20% жёлтых / 5% красных

Это **не сравнительный** блок: нет «лучший vs худший», есть «вот что сделала ваша команда».

### 6. Профиль вклада на странице сотрудника

**`/me/contributions`** и **`/persons/[id]/contributions`** (вторая видна руководителю):

- Идеи: всего N, в работе M, выпущено K (только числа, без сравнения).
- «Спасибо» от коллег: N за всё время / за последний месяц.
- Стрик чек-инов (текущий + лучший).
- Бейджи (см. ниже).

**Бейджи (визуальные отметки, без очков):**
- 💡 Идеатор — 5+ идей в работе
- 🧠 Эксперт — N полезных ответов в чате задач
- 🤝 Помощник — 10+ «спасибо» от коллег
- 🎯 Стрелок — 90%+ задач привязано к целям
- 📝 Стабильный — 60 дней чек-инов подряд

**Бейджи не сравниваются между людьми.** У каждого свой набор — у того кто пишет 100 комментариев и у того кто закрывает 50 задач — разные бейджи.

### 7. Геймификация публичной ленты инсайтов

- Реакция «полезно» / «у меня тоже» / «спасибо что подсветил» — мини-признание.
- Когда инсайт получает 5+ реакций — отметка «команда отозвалась», в ленте подсвечен.
- Автор инсайта (тот человек, чей чек-ин или комментарий был источником) получает мини-уведомление.

### 8. (опционально, обсуждаемо) Раз в квартал — «Кружок благодарностей»

AI-агент за неделю до конца квартала формирует «карту благодарностей»: кто кого благодарил, какие команды наиболее взаимовыручали.

Это **не отчёт**, а **дайджест для руководителя** — что разладилось во взаимодействии команд, кому стоит сказать персональное спасибо вживую.

## Модель данных

### Recognition

```
model Recognition {
  id              String   @id @default(cuid())
  tenantId        String
  
  fromUserId      String?              // null если от AI / системы
  toUserId        String
  
  type            String              // thanks_comment | thanks_helpfulness | mention_helped | idea_shipped | streak_milestone | weekly_summary
  
  contextEntityType String?            // issue_comment | insight | regulation | idea | checkin
  contextEntityId   String?
  
  message         String?  @db.Text
  
  visibility      String   @default("private") // private | team | public_org
  
  createdAt       DateTime @default(now())
  
  @@index([toUserId, createdAt])
  @@index([tenantId, type])
}
```

### Badge

```
model Badge {
  id          String   @id @default(cuid())
  slug        String   @unique          // ideator | expert | helper | aligned | consistent
  name        String                   // «Идеатор», «Эксперт», ...
  description String   @db.Text
  iconUrl     String?
  condition   Json                     // { type: 'ideas_in_dev', threshold: 5 } и т.д.
  
  createdAt   DateTime @default(now())
}

model UserBadge {
  id        String   @id @default(cuid())
  userId    String
  badgeId   String
  awardedAt DateTime @default(now())
  
  @@unique([userId, badgeId])
}
```

### ContributionSnapshot (агрегированные показатели — обновляются cron'ом)

```
model ContributionSnapshot {
  id                String   @id @default(cuid())
  userId            String
  
  ideasInDevelopment   Int   @default(0)
  ideasShipped         Int   @default(0)
  thanksReceived       Int   @default(0)
  thanksReceivedWeek   Int   @default(0)
  
  currentCheckinStreak Int   @default(0)
  longestCheckinStreak Int   @default(0)
  
  helpfulComments      Int   @default(0)
  probeQuestionsAnswered Int @default(0)
  
  updatedAt         DateTime @updatedAt
  
  @@unique([userId])
}
```

### Дополнения к существующим моделям

```
// IssueComment — добавить
model IssueComment {
  // ... существующие поля
  thanksUserIds String[]              // те кто нажал «спасибо»
}

// IdeaBlock — добавить новые signalType в α-2:
//   helped_by — «мне помог X»
//   helped_to — «я помог Y» (extracted из чек-инов и обсуждений)
//   thanks_explicit — явная благодарность в тексте
```

## REST API

```
GET    /api/v1/me/contributions               # свой профиль вклада
GET    /api/v1/persons/:id/contributions      # для руководителя
GET    /api/v1/me/recognitions                # мои полученные благодарности
GET    /api/v1/badges                         # каталог бейджей
GET    /api/v1/me/badges                      # мои бейджи

POST   /api/v1/comments/:id/thanks            # сказать спасибо за комментарий
DELETE /api/v1/comments/:id/thanks

POST   /api/v1/feed/:itemId/react             # уже есть в Activity Feeds — реакция thanks/helpful
```

## Cron-задачи

- **`RecognitionWeeklyDigestCron`** (`0 9 * * MON`) — Recognition Agent шлёт благодарности.
- **`ContributionSnapshotCron`** (`0 4 * * *`) — пересчитывает агрегаты для всех пользователей.
- **`BadgeAwarderCron`** (`0 5 * * *`) — проверяет условия бейджей, выдаёт новые.
- **`StreakDetectorCron`** (`0 23 * * *`) — фиксирует стрики чек-инов.

## Frontend

### Страницы (новые)

- `/me/contributions` — мой вклад (числа, бейджи, история благодарностей)
- `/persons/[id]/contributions` — вклад сотрудника (для руководителя)

### Виджеты (встраиваемые)

- `<TeamSpotlightWidget>` — «Команда на этой неделе» — на COO Dashboard и руководителя
- `<MyContributionsWidget>` — компактный блок на `/me` и `/dashboard` для рядового
- `<RecognitionFeedWidget>` — лента благодарностей (опц. на dashboard)

### UX-правила

- **Никаких всплывающих окон с благодарностями** — это раздражает. Только лента и уведомления.
- **Никаких звуков/анимаций при получении бейджа** — мягкая отметка в профиле, всё.
- **Никаких счётчиков очков в UI основного трекера.** Геймификация — отдельная страница `/me/contributions`, не лезет в задачи.
- **Опт-аут:** в настройках пользователь может отключить уведомления Recognition Agent целиком.

## Probe-trigger (новые)

- `low_team_engagement` — у Recognition Agent: «команда А делает чек-ины <30% — что у руководителя?»
- `unrecognized_high_contributor` — «у Иванова много вклада, но 0 явных благодарностей — может, руководитель в курсе?»

## Метрики Prometheus

```
recognition_sent_total{tenant, type, from_user_or_ai}
thanks_total{tenant, context_type}
badges_awarded_total{tenant, badge}
checkin_streak_distribution{tenant} (histogram)
contribution_snapshot_updates_total{tenant}
recognition_agent_messages_sent_total{tenant}
```

## RBAC

Новый ResourceType:
- `recognition` — read (свои), write (только система + AI Recognition Agent)
- `badge` — read (все), write (admin)
- `user_badge` — read (свои + руководитель видит подчинённых), write (только Cron)
- `contribution_snapshot` — read (свой + руководитель команды на свои), write (только Cron)

## Связь с другими sub-ТЗ

- **β-8 COO Dashboard + DailyCheckIn** — Recognition Agent читает чек-ины, ищет упоминания помощи.
- **Activity Feeds** — благодарности и спотлайты публикуются как элементы ленты.
- **β-5 Ideas Collector** — `idea.status='in_development'` триггерит Recognition для автора.
- **α-2 signalType** — новые типы `helped_by`, `helped_to`, `thanks_explicit`.

## DoD

- [x] Модели Recognition, Badge, UserBadge, ContributionSnapshot в Prisma
- [x] Recognition Agent (новый воркер) работает: раз в неделю шлёт благодарности активным
- [x] 5 базовых бейджей определены (seed)
- [x] Кнопка «Спасибо» в комментариях и реакции в Activity Feed работают
- [ ] Страница `/me/contributions` отображает свой вклад  <!-- backend ContributionsController готов, frontend страница отсутствует -->
- [ ] Виджет «Команда на этой неделе» на COO Dashboard и для руководителя  <!-- TeamSpotlightWidget / MyContributionsWidget отсутствуют -->
- [x] Cron-задачи (4 шт.) работают
- [x] LlmTaskType `recognition-formulate` с тройной цепочкой провайдеров
- [ ] Опт-аут в `/me/settings/notifications`  <!-- backend готов, frontend UI отсутствует -->
- [x] Метрики Prometheus
- [x] Unit + integration tests

## Срок

**3 человеко-недели.** Можно делать параллельно с Activity Feeds и β-8 (всё связано).

## Открытые вопросы для владельца

1. **Должен ли Recognition Agent шлёт благодарности от имени AI или от имени руководителя?** Я предлагаю — от имени AI («Я заметил, что на этой неделе ты помог...»), чтобы не подделывать голос человека. Можно опционально: «руководитель видит проект благодарности, может одобрить и отправить от себя».

2. **Стоит ли показывать топ-3 «активистов» команды раз в месяц** — или это уже слишком рейтинг? Я склонен **нет** (только индивидуальные «спасибо»). Но это твоё решение.

3. **Бейджи — публичны или только себе?** Я предлагаю показывать в профиле сотрудника (`/persons/[id]/contributions`) — руководитель видит, коллеги видят. Только если сам сотрудник скрыл.

4. **Идеи клиентов (external) — кто получает thanks?** Если идея клиента «пошла в работу» — благодарим только аккаунт-менеджера, который её зафиксировал? Или ещё что-то?

---

_2026-05-23: геймификация мягкая, через признание и AI-сообщения, без рейтингов и баллов._

## Ревизия от 2026-05-24

**Статус:** partial
**Реализовано:**
- Модели `Recognition` (schema.prisma:6809), `Badge`, `UserBadge`, `ContributionSnapshot` (6861).
- `RecognitionModule` (@Global) в `backend/src/modules/recognition/`: `RecognitionService`, `CommentsThanksService`, `BadgeConditionsService`, `RecognitionFormulateWorker`, 4 cron'а (ContributionSnapshot, BadgeAwarder, RecognitionWeeklyDigest, StreakDetector).
- 4 контроллера: contributions, badges, comments-thanks, recognition-admin.
- Seed бейджей: `backend/src/modules/recognition/seed/badge-seed.ts`.
- LlmTaskType seed: `backend/scripts/seed-llm-task-routes-recognition.ts`.
- RBAC ресурсы `recognition` / `badge` / `user_badge` / `contribution_snapshot` (policy.csv:826-854).
- Wave 2 finishing (commits 0365d6c, 1a35a38) — Helpfulness → Recognition bridge + Recognition → ActivityFeed publish.
- Spec'и: 6 файлов (`badge-conditions.spec`, `badge-awarder.cron.spec`, `contribution-snapshot.cron.spec`, `recognition-weekly-digest.cron.spec`, `streak-detector.cron.spec`, `recognition-formulate.worker.spec`, `comments-thanks.service.spec`, `badge-seed.spec`).

**Осталось:**
- Frontend страница `/me/contributions` (backend ContributionsController готов; UI не создан).
- Frontend страница `/persons/[id]/contributions` (для руководителя).
- Виджеты `<TeamSpotlightWidget>`, `<MyContributionsWidget>`, `<RecognitionFeedWidget>` (не реализованы в `frontend/src/ui/`).
- UI опт-аута в `/me/settings/notifications` (backend ready).
