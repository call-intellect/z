---
type: tz
status: partial
feature: Specialist 3.8 — Агент-помощник (Helpfulness Specialist) — выделяет людей-помощников из переписки и созвонов, показывает их публично в ленте
date: 2026-05-23
parent: plans/analysis/2026-05-23-product-overview-simple.md
related:
  - plans/tz/2026-05-23-gamification-and-motivation.md
  - plans/tz/2026-05-23-activity-feeds.md
  - plans/tz/2026-05-23-sba-beta-2-specialist-3-2-knowledge-clone.md
  - plans/tz/2026-05-23-sba-gamma-1-specialist-3-7-skill-and-clone.md
  - plans/tz/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md
---

# Specialist 3.8 — Агент-помощник (Helpfulness Specialist)

## TL;DR

**Новый специалист Слоя 3** — анализирует переписку в задачах, фрагменты транскриптов встреч и чек-ины, выделяет **паттерны помощи**: кто отвечает на вопросы коллег, кто менторит, кто проактивно подсказывает, кто эмоционально поддерживает. Накапливает **профиль социального вклада** каждого сотрудника. Раз в неделю формирует **спотлайты лучших помощников** для публичной ленты «Спасибо команды» и питает Recognition Agent данными для благодарностей. Главный принцип: **показываем только позитив публично**, негативные сигналы — только админский анализ для HR. Срок: 4 человеко-недели.

## Зачем это нужно

В каждой команде есть «социальный клей» — люди, которые тратят своё время на помощь коллегам, ответы на вопросы, обучение новеньких. Они:
- Часто **самые ценные** для команды (не по KPI, но по фактическому вкладу).
- Часто **самые незаметные** — их работу не фиксируют в задачах, она «между задач».
- Их **первыми перекупают** конкуренты, когда уходят — рушится культура.
- Им **редко благодарят системно** — только эпизодически.

Платформа Z/Кора уже собирает всю переписку — мы **видим** этих людей в данных. Не использовать это — упускать главную мотивационную возможность.

## Связь с другими агентами

| Агент | Что делает | Связь с нашим |
|---|---|---|
| **Specialist 3.2 Knowledge Clone** (β-2) | Что человек **знает** (факты, опыт) | Наш агент дополняет: **как** человек делится знаниями |
| **Specialist 3.7 Skill Profile** (γ-1) | Как человек **думает**, какие решения принимает | Наш агент дополняет: **как** человек взаимодействует |
| **Specialist 3.5 Insights Radar** (β-4) | Повторяющиеся **проблемы** | Не пересекаемся (разные сущности) |
| **β-8 PersonalRelation** | Кто кого о чём **просит** (кто-кому связи) | Наш агент дополняет: **качество** этих связей (помог / проигнорил / решил) |
| **Recognition Agent** (из gamification) | **Отправляет** благодарности | **Питается данными от нас** — кому слать благодарности и за что |

## Что делает агент

### Источники данных (через расширение α-2 signalType)

Анализирует следующие источники через стандартный pipeline knowledge-core (RawEvent → IdeaBlock → специалист):

1. **Комментарии в задачах** — реплики коллег друг другу.
2. **Чат-в-задаче** — обсуждения, голосовые.
3. **Фрагменты транскриптов встреч** — кто кого учил/подсказывал/спрашивал.
4. **Чек-ины** — упоминания «мне помог», «помог Иванову», «спросил у Алёны».
5. **Ответы на probe-questions** — кто реально отвечает агентам vs игнорирует.

### Паттерны для извлечения

Новые типы блоков (расширение α-2 signalType):

| signalType | Что означает |
|---|---|
| `help_provided` | Развёрнутый ответ на вопрос коллеги |
| `proactive_hint` | Подсказка без запроса («кстати, у нас есть инструкция по X») |
| `mentoring` | Обучающее объяснение (не просто «делай Y», а «потому что Z») |
| `emotional_support` | «Не переживай», «давай разберёмся вместе» |
| `constructive_feedback` | Конструктивная критика с предложением решения |
| `question_unanswered` | Вопрос задан конкретному человеку → нет ответа 48ч |
| `question_acknowledged_no_action` | «Хорошо, посмотрю» → нет следующего шага |

**ВАЖНО (этика):** все 7 типов извлекаются и хранятся, но **публично показываются только первые 5** (позитивные). Последние 2 (`question_unanswered`, `question_acknowledged_no_action`) — только в админском интерфейсе для HR/руководителя.

### LlmTaskType (новые)

1. **`helpfulness-detect`** — извлечение паттернов помощи из блока:
   - Primary: DeepSeek (через proxy.agent-lia.ru)
   - Secondary: OpenAI gpt-4o-mini (через proxy.agent-lia.ru)
   - Tertiary: Ollama qwen3.5:9b
   - Output schema: `{ helpfulness_traits: [{ type, intensity, recipient_user_hint, evidence_quote }] }`

2. **`helpfulness-trait-merge`** — объединение похожих trait'ов через KNN (cosine 0.82 порог):
   - Primary: DeepSeek
   - Secondary: OpenAI gpt-4o-mini
   - Tertiary: Ollama qwen3.5:9b

3. **`helpfulness-spotlight-formulate`** — формулировка публичного «спасибо»:
   - Primary: DeepSeek (нужна capable модель, чтобы текст звучал тепло, а не казённо)
   - Secondary: OpenAI gpt-4o
   - Tertiary: Ollama qwen3.5:9b
   - Output: короткое тёплое сообщение, например «Иван 12 раз на этой неделе помог коллегам по вопросам безопасности — спасибо за щедрость с экспертизой».

## Модель данных

### HelpfulnessTrait

```
model HelpfulnessTrait {
  id              String   @id @default(cuid())
  tenantId        String
  
  helperUserId    String              // кто помог
  recipientUserId String?             // кому помог (если ясно из контекста)
  
  traitType       String              // help_provided | proactive_hint | mentoring | emotional_support | constructive_feedback | question_unanswered | question_acknowledged_no_action
  intensity       Decimal  @db.Decimal(4,3)  // 0..1 — насколько ярко проявлено
  
  topicHint       String?             // о чём была помощь (например, «настройка платежей», «найм сотрудников»)
  
  // Источник
  sourceBlockIds  String[]            // из каких IdeaBlock извлечено
  evidenceQuote   String?  @db.Text   // цитата (для прозрачности)
  
  // Контекст
  contextEntityType String?           // issue_comment | meeting_transcript_chunk | checkin
  contextEntityId   String?
  
  // Эмбеддинг для merge через KNN
  embedding       Unsupported("vector(1536)")?
  
  // Доверие
  confidence      Decimal  @db.Decimal(4,3)
  
  // Видимость (по умолчанию — internal, только админ + сам helper видит)
  visibility      String   @default("internal") // public_team | internal | restricted
  
  // Жизненный цикл
  lastObservedAt  DateTime
  decayedAt       DateTime?           // если давно не повторялось, помечается decay'ом
  status          String   @default("active") // active | decayed | mark_as_misleading
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([tenantId, helperUserId])
  @@index([tenantId, traitType, status])
}
```

### SocialContributionProfile (агрегат per person)

```
model SocialContributionProfile {
  id                      String   @id @default(cuid())
  tenantId                String
  userId                  String
  
  // Кеш счётчиков (пересчитывается cron'ом)
  helpProvidedCount       Int      @default(0)
  proactiveHintCount      Int      @default(0)
  mentoringCount          Int      @default(0)
  emotionalSupportCount   Int      @default(0)
  
  // Темы экспертизы — где человек чаще всего помогает
  expertiseTopics         String[]
  
  // Социальные роли (определяется по паттернам, не назначается)
  socialRoles             String[]   // mentor | connector | problem_solver | mood_keeper | trainer
  
  // За последний период
  lastWeekHelpCount       Int      @default(0)
  lastMonthHelpCount      Int      @default(0)
  
  // Сводный «вклад в команду» (для дашборда руководителя — НЕ публично, НЕ как рейтинг)
  contributionScoreCached Decimal? @db.Decimal(6,3)
  
  buildVersion            Int      @default(1)
  lastBuiltAt             DateTime
  
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
  
  @@unique([tenantId, userId])
  @@index([tenantId])
}
```

### HelpfulnessSpotlight (публичный «спасибо» для ленты)

```
model HelpfulnessSpotlight {
  id              String   @id @default(cuid())
  tenantId        String
  
  helperUserId    String
  topicHint       String?
  message         String   @db.Text             // от LLM
  
  // Период spotlight'а
  periodFrom      DateTime
  periodTo        DateTime
  
  // Сколько случаев помощи на этот период
  helpCount       Int
  
  // Связанные trait'ы
  traitIds        String[]
  
  // Status
  status          String   @default("pending") // pending | approved | published | hidden
  approvedByUserId String?              // руководитель может одобрить / скрыть
  
  publishedAt     DateTime?
  feedItemId      String?              // ссылка на ActivityFeedItem
  
  createdAt       DateTime @default(now())
  
  @@index([tenantId, status])
  @@index([helperUserId, periodFrom])
}
```

## Worker и Cron

### Worker: `specialist-3-8-helpfulness.worker`

- **Consumer:** `core.specialist-routing` jobName=`3-8-helpfulness`
- **Триггер:** RouterService (α-3) направляет блоки с признаками социального взаимодействия (signalType из переписки/чек-инов/транскриптов с упоминаниями людей)
- **Логика:**
  1. Получает блок (`IdeaBlock`).
  2. Вызывает `helpfulness-detect` LLM.
  3. Для каждого извлечённого trait'а:
     - KNN-поиск похожих в `HelpfulnessTrait` (cosine 0.82)
     - Если найден — merge через `helpfulness-trait-merge`, обновление `lastObservedAt` + `intensity`
     - Если нет — создание нового `HelpfulnessTrait`
  4. Эмитит `helpfulness.trait_detected` в event-bus.
  5. Регистрируется в `CardSpecialistRegistry`.

### Cron-задачи

- **`SocialContributionProfileCron`** (`0 5 * * *`) — пересборка `SocialContributionProfile` для всех активных пользователей: агрегация trait'ов, обновление счётчиков, определение `expertiseTopics` и `socialRoles`.

- **`HelpfulnessSpotlightCron`** (`0 9 * * MON`) — раз в неделю формирует спотлайты:
  - Для каждого тенанта берёт людей с `lastWeekHelpCount >= 3` или с явно выраженной экспертизой.
  - Вызывает `helpfulness-spotlight-formulate` LLM с контекстом профиля и trait'ов недели.
  - Создаёт `HelpfulnessSpotlight` в статусе `pending`.
  - Отправляет руководителю команды через ConversationalChannels на одобрение.
  - После одобрения — публикует в `ActivityFeed` с `feedType='spotlight'` и `visibility='public_team'`.

- **`HelpfulnessTraitDecayCron`** (`0 6 * * *`) — старые trait'ы (>90 дней без повторения) помечаются `decayedAt`, исключаются из активных счётчиков (но не удаляются — история).

## Probe-trigger'ы (новые)

1. **`new_expertise_helper_detected`** — у кого-то новая тема, по которой он начал помогать. Probe → коллегам: «У Иванова появилась экспертиза по X. Хотите подписаться на его комментарии по этой теме?»

2. **`unrecognized_high_contributor`** — у Иванова 15+ trait'ов помощи за неделю, но 0 явных благодарностей. Probe → руководителю команды: «Иванов был очень активным помощником на этой неделе. Может, сказать ему спасибо лично?»

3. **`mentor_emerging`** — у Иванова резко выросло количество `mentoring` trait'ов по конкретной теме. Probe → руководителю: «Иванов превращается в ментора по X — рассмотрите как формального обучателя новых сотрудников».

4. **`question_chain_unanswered`** — у Петрова 5+ `question_unanswered` за неделю (он спрашивал, ему не отвечали). Probe → **только руководителю**: «Петрову не отвечают на вопросы, проверьте контакт». **НЕ публично.**

## Frontend

### Страницы

1. **`/feed/spotlights`** — публичная лента «Спасибо команде» — все одобренные `HelpfulnessSpotlight`. Открыт всем.

2. **`/me/social-contribution`** — мой профиль социального вклада:
   - Темы где я помогаю чаще всего (с количеством случаев)
   - Социальные роли (Mentor / Connector / Problem Solver / ...)
   - История моих спотлайтов
   - Цитаты-доказательства (для прозрачности)
   - Кнопка «отметить как ошибку» (`mark_as_misleading`)

3. **`/persons/[id]/social-contribution`** — профиль сотрудника (видит руководитель команды + сам сотрудник). Те же поля. **Не виден коллегам в полном виде** — только публичные спотлайты.

4. **`/admin/helpfulness-overview`** — админский дашборд для главного администратора:
   - Карта помощников команды
   - Кто-кому помогает (граф связей)
   - Кому не отвечают на вопросы (приватно, для HR)
   - Тренды по теме экспертизы

### Виджеты

- **`<HelpfulPeopleWidget>`** — мини-блок на COO Dashboard «Помощники недели» с 3-5 именами и темами.
- **`<SpotlightsFeedWidget>`** — встраиваемый виджет ленты спотлайтов.
- **`<MyContributionWidget>`** — компактный блок на `/me/dashboard` («ты помог X раз на этой неделе»).

## REST API

```
GET    /api/v1/me/social-contribution             # свой профиль
GET    /api/v1/persons/:id/social-contribution    # для руководителя + самого

GET    /api/v1/feed/spotlights                    # публичная лента
POST   /api/v1/spotlights/:id/approve             # руководитель одобряет
POST   /api/v1/spotlights/:id/hide                # скрыть спотлайт
POST   /api/v1/spotlights/:id/republish           # пере-опубликовать

GET    /api/v1/admin/helpfulness/team-map         # для главного админа
GET    /api/v1/admin/helpfulness/unanswered       # вопросы без ответов (только админ + руководитель)

POST   /api/v1/social-contribution/traits/:id/mark-wrong   # пометить trait как «это про меня неправда»
```

## Privacy & Ethics — критично

### Принципы

1. **Публично — только позитив.** `question_unanswered`, `question_acknowledged_no_action` — только админский интерфейс. Никогда в публичной ленте, никогда в Activity Feed для общего просмотра.

2. **Сам сотрудник видит ВСЁ что собрано про него.** Полная прозрачность: какие trait'ы извлечены, из каких источников, с какими цитатами. Можно пометить как ошибку — будет исключено.

3. **Спотлайты — только с одобрения руководителя.** Не публикуются автоматически. Руководитель может скрыть. Если человек попросит — спотлайт навсегда скрывается из его профиля.

4. **Опт-аут целиком.** В `/me/settings/privacy` — кнопка «Отключить наблюдение за моим социальным вкладом». При включении — все собранные trait'ы помечаются `status='opt_out'`, не учитываются в агрегатах, не показываются нигде.

5. **Нет рейтинга.** Никакого «топ-10 помощников» сравнительного. Только индивидуальные счётчики и темы.

6. **Нет публичного «не помогает».** Если у человека мало trait'ов — нигде не отмечается «вот этот не помогает». Это **не его вина** (может быть, его никто не спрашивает, может быть, он помогает офлайн).

7. **Сигналы о невнимании — только админу.** Если кому-то не отвечают на вопросы — это сигнал руководителю **посмотреть динамику**, не «выкрутить» сотрудника.

## RBAC

Новый ResourceType:

- `helpfulness_trait` — read: свои + админ + руководитель команды; write: только worker
- `social_contribution_profile` — read: свой + руководитель команды на своих + админ; write: только Cron
- `helpfulness_spotlight` — read: public_team если status='published', иначе только участники; write: только worker, approve: руководитель команды

## Связь с другими модулями

| Модуль | Что меняем |
|---|---|
| **α-2 signalType** | +7 новых типов: help_provided, proactive_hint, mentoring, emotional_support, constructive_feedback, question_unanswered, question_acknowledged_no_action |
| **α-3 RouterService** | Маршрутизация новых signalType к `3-8-helpfulness` |
| **CardSpecialistRegistry** | Регистрация нового специалиста |
| **β-8 PersonalRelation** | Расширение: `relation_quality` (positive/neutral/negative) на основе trait'ов |
| **Recognition Agent (gamification)** | Использует данные нашего агента: «у Иванова 12 mentoring trait'ов за неделю — отправь благодарность» |
| **Activity Feeds** | Новый `feedType='spotlight'` — публичные спасибо |
| **Probe Agent** | +4 новых probe-trigger'а |
| **chat-v2 getCitations** | Поддержка ссылок на trait'ы при ответе на вопросы про сотрудников |

## Метрики Prometheus

```
helpfulness_traits_detected_total{tenant, trait_type}
helpfulness_traits_active_count{tenant}
social_contribution_profiles_built_total{tenant}
helpfulness_spotlights_created_total{tenant, status}
helpfulness_spotlights_approved_total{tenant}
helpfulness_spotlights_hidden_total{tenant}
helpfulness_opt_out_count{tenant}
```

## DoD

- [x] 3 модели Prisma: HelpfulnessTrait, SocialContributionProfile, HelpfulnessSpotlight
- [x] 7 новых signalType в α-2
- [x] Worker `specialist-3-8-helpfulness.worker` подписан на `core.specialist-routing`
- [x] 3 LlmTaskType зарегистрированы с тройной цепочкой (`helpfulness-detect`, `helpfulness-trait-merge`, `helpfulness-spotlight-formulate`)
- [x] 3 cron-задачи: SocialContributionProfileCron, HelpfulnessSpotlightCron, HelpfulnessTraitDecayCron
- [x] 4 probe-trigger'а через ProbeService
- [x] REST endpoints
- [ ] Frontend: 4 страницы + 3 виджета  <!-- /feed/spotlights есть; /me/social-contribution, /persons/[id]/social-contribution, /admin/helpfulness-overview + 3 виджета отсутствуют -->
- [x] Этические защиты: opt-out, прозрачность, mark-as-misleading, ручное одобрение спотлайтов руководителем
- [x] Никаких публичных негативных сигналов
- [x] RBAC ResourceType + visibility-scope
- [x] Метрики Prometheus
- [x] Тесты: unit (LLM-маппинг) + integration (worker → trait → profile → spotlight) + e2e (Playwright: спотлайт публикуется после одобрения)

## Срок

**4 человеко-недели.** Можно делать параллельно с Recognition Agent (gamification-and-motivation.md) — они связаны и должны выйти вместе.

## Открытые вопросы для владельца

1. **Должны ли спотлайты автоматически публиковаться** для случаев с очень высокой уверенностью (например, 20+ trait'ов помощи) — или всегда через ручное одобрение руководителем? Я предлагаю: **всегда ручное** (без автопубликации). Лучше медленнее, но без рисков.

2. **Кто видит частные сигналы `question_unanswered`** — только главный администратор / HR, или ещё руководитель команды? Я предлагаю: **главный администратор + руководитель той команды, к которой относится цепочка вопросов**.

3. **Должны ли клиенты (внешние, гости встреч) учитываться** в анализе? Я предлагаю: **нет** — анализируем только сотрудников организации. Внешние клиенты не должны попадать в профиль «помощника».

4. **Какие 5-7 «социальных ролей» признаём** автоматически? Предложение:
   - **Ментор** — много `mentoring` trait'ов
   - **Соединитель** — связывает людей друг с другом (по PersonalRelation)
   - **Решатель проблем** — много `help_provided` по конкретным темам
   - **Хранитель настроения** — много `emotional_support` trait'ов
   - **Обучатель новеньких** — `mentoring` + связь с новичками в `PersonalRelation`
   - **Идеатор** — много идей которые пошли в работу
   - **Эксперт по X** — концентрация trait'ов по конкретной теме

   Подтвердить список / убрать / добавить.

5. **Стоит ли запоминать «социальные роли» в γ-1 SkillProfile** или это отдельная характеристика? Я предлагаю: **отдельная**, в `SocialContributionProfile.socialRoles`. Skill — про работу, наш агент — про взаимодействие.

---

_2026-05-23: новый специалист Слоя 3 для выделения людей-помощников. Главный принцип — публично только позитив, никаких рейтингов, прозрачность для самого сотрудника._

## Ревизия от 2026-05-24

**Статус:** partial
**Реализовано:**
- 3 модели в schema.prisma: `HelpfulnessTrait` (6705), `SocialContributionProfile`, `HelpfulnessSpotlight`.
- `Specialist38HelpfulnessModule` (`backend/src/modules/specialist-3-8-helpfulness/`): worker `specialist-3-8-helpfulness.worker.ts`, 3 cron'а (helpfulness-spotlight, helpfulness-trait-decay, social-contribution-profile), `helpfulness-probe.cron.ts`.
- 4 сервиса: `specialist-3-8-helpfulness.service`, `helpfulness-api.service`, `specialist-3-8-probe.service`.
- 2 контроллера: `helpfulness.controller` + `helpfulness-admin.controller`.
- Промпты: `helpfulness.prompts.ts` (3 LlmTaskType).
- LlmTaskType seed: `backend/scripts/seed-llm-task-routes-helpfulness.ts`.
- HNSW индекс для `HelpfulnessTrait.embedding` (Wave 2 finishing commit 389092a).
- Bridge → Recognition при approve spotlight (Wave 2 finishing commit 0365d6c).
- RBAC `helpfulness_trait` + `helpfulness_spotlight` (policy.csv:793-820).
- Frontend `/feed/spotlights` страница есть (через ActivityFeed).
- Spec'и: `specialist-3-8-helpfulness.service.spec`, `worker.spec`, `helpfulness-trait-decay.cron.spec`, `helpfulness-api.service.spec`.

**Осталось:**
- Frontend страницы: `/me/social-contribution`, `/persons/[id]/social-contribution`, `/admin/helpfulness-overview` (backend REST готов; UI отсутствует).
- Виджеты `<HelpfulPeopleWidget>`, `<SpotlightsFeedWidget>`, `<MyContributionWidget>` в `frontend/src/ui/` не созданы.
- API client `helpfulness.api.ts` во frontend отсутствует.
