---
type: tz
status: draft
feature: user-feedback-with-ai-clustering
date: 2026-05-25
---

# ТЗ: «Ваши предложения» — пользовательский фидбэк с AI-кластеризацией в смысловые блоки

> Контекст из чата: пользователь хочет канал прямой обратной связи, чтобы быстро понимать, чего не хватает, что бесит и что хвалят. Раз в сутки AI-агент собирает все новые обращения и распределяет их по смысловым блокам (создаёт новые, если нужно). Super-admin Z видит дашборд блоков с процентами.

## Цель

Дать каждому зарегистрированному пользователю простой канал «написать команде Z, чего не хватает», а нам — агрегированную картину обратной связи в виде смысловых блоков с процентами и возможностью провалиться в детали.

## Scope

**Входит (MVP):**
- Вкладка «Ваши предложения» в сайдбаре фронта для аутентифицированных пользователей.
- Форма отправки + лимит 5 в сутки на `userId` (окно UTC).
- История своих обращений у пользователя.
- БД: `FeedbackMessage`, `FeedbackItem`, `FeedbackTopic` + связи.
- Эндпоинты: пользовательский POST / GET my, админский CRUD блоков и items.
- Ночной BullMQ-воркер (cron 01:00 UTC) — кластеризация AI-агентом.
- Промпт `feedback.cluster` в существующем prompt-registry + taskType в LLM-router с fallback-цепочкой.
- Дашборд для super-admin Z: список блоков, переключатель окна (30/90/всё), сортировка по % items, базовый поиск.
- Страница блока: список items с автором и датой, разворот в исходное сообщение.
- Действия над блоком: rename, merge, archive.

**Не входит (фаза 2):**
- Статусы для пользователя («учтено / в работе / отклонено»).
- Split блока (ручное разделение items).
- Notification (уведомления админу о новых блоках).
- Поиск по тексту items, фильтр по org/дате в дашборде.
- Embedding-предфильтрация existingTopics для агента (активируем, когда блоков станет 100+).
- GDPR-псевдонимизация items удалённого пользователя.
- Экспорт CSV / Excel.

## Архитектура — общая схема

```
┌──────────────────────────────────────────────────────────────┐
│ Пользователь (frontend, /feedback)                            │
│  - форма ввода + лимит 5/сутки                                │
│  - история своих сообщений                                    │
└─────────────────┬────────────────────────────────────────────┘
                  │ POST /api/v1/feedback
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ Backend: модуль feedback                                      │
│  - FeedbackController (user + admin)                          │
│  - FeedbackService                                            │
│  - FeedbackRateLimitGuard (Redis-счётчик)                     │
│  - FeedbackDigestService (для воркера)                        │
└─────────────────┬────────────────────────────────────────────┘
                  │ записи в БД (processedAt = null)
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ Postgres: FeedbackMessage / FeedbackItem / FeedbackTopic     │
└──────────────────────────────────────────────────────────────┘
                  ▲
                  │ ночной прогон (cron 01:00 UTC)
┌─────────────────┴────────────────────────────────────────────┐
│ BullMQ-воркер feedback-digest                                 │
│  1. собрать все processedAt=null                              │
│  2. подгрузить все ACTIVE FeedbackTopic                       │
│  3. вызвать LLM (DeepSeek V4 Pro → fallback chain)            │
│  4. распарсить JSON                                           │
│  5. в одной транзакции: создать новые topics + items + mark   │
└──────────────────────────────────────────────────────────────┘
                  ▲
                  │ GET /api/v1/admin/feedback/...
┌─────────────────┴────────────────────────────────────────────┐
│ Super-admin Z (frontend, /admin/feedback)                    │
│  - дашборд блоков с %                                         │
│  - drill-down → список items                                  │
│  - actions: rename / merge / archive                          │
└──────────────────────────────────────────────────────────────┘
```

## Технические изменения

### База данных (Prisma)

Все новые модели — в `backend/prisma/schema.prisma`. Применять через `bun run prisma:push` (не `migrate`).

```prisma
model FeedbackMessage {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  orgId       String?
  org         Org?      @relation(fields: [orgId], references: [id], onDelete: SetNull)
  text        String    @db.Text
  createdAt   DateTime  @default(now())
  processedAt DateTime?
  failedRuns  Int       @default(0)   // счётчик неудачных попыток обработки
  items       FeedbackItem[]

  @@index([processedAt])
  @@index([userId, createdAt])
}

model FeedbackTopic {
  id            String                @id @default(cuid())
  title         String
  description   String                @db.Text
  status        FeedbackTopicStatus   @default(ACTIVE)
  archivedAt    DateTime?
  createdAt     DateTime              @default(now())
  updatedAt     DateTime              @updatedAt
  mergedIntoId  String?
  mergedInto    FeedbackTopic?        @relation("FeedbackTopicMerge", fields: [mergedIntoId], references: [id])
  mergedFrom    FeedbackTopic[]       @relation("FeedbackTopicMerge")
  items         FeedbackItem[]

  @@index([status])
  @@index([createdAt])
}

enum FeedbackTopicStatus {
  ACTIVE
  ARCHIVED
  MERGED
}

model FeedbackItem {
  id            String           @id @default(cuid())
  messageId     String
  message       FeedbackMessage  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  topicId       String?          // null если discarded (мусор/спам)
  topic         FeedbackTopic?   @relation(fields: [topicId], references: [id], onDelete: SetNull)
  text          String           @db.Text   // тезис, выделенный агентом
  discarded     Boolean          @default(false)
  discardReason String?          // 'spam' | 'unintelligible' | 'off-topic'
  createdAt     DateTime         @default(now())

  @@index([topicId, createdAt])
  @@index([messageId])
  @@index([discarded])
}
```

Также нужно добавить обратные релейшены в существующие модели `User` и `Org`:

```prisma
model User {
  // ...
  feedbackMessages FeedbackMessage[]
}

model Org {
  // ...
  feedbackMessages FeedbackMessage[]
}
```

### Backend

Новый модуль: `backend/src/modules/feedback/`.

```
feedback/
  feedback.module.ts
  controllers/
    feedback-user.controller.ts        # пользовательский, /api/v1/feedback
    feedback-admin.controller.ts       # super-admin, /api/v1/admin/feedback
  services/
    feedback.service.ts                # CRUD + rate-limit логика
    feedback-digest.service.ts         # ночной прогон, агент, парсинг
    feedback-topic-manager.service.ts  # rename / merge / archive
  guards/
    feedback-rate-limit.guard.ts       # Redis-счётчик 5/UTC-сутки
    super-admin.guard.ts               # (если ещё нет — переиспользовать существующий)
  dto/
    submit-feedback.dto.ts
    feedback-message.dto.ts
    feedback-topic.dto.ts
    feedback-item.dto.ts
    topic-list-filters.dto.ts          # окно 30/90/all, поиск, сортировка
    rename-topic.dto.ts
    merge-topics.dto.ts
  prompts/
    feedback-cluster.prompt.ts         # системный промпт + code fallback
```

**Пользовательские эндпоинты** (`/api/v1/feedback`, под общим JWT-Guard'ом):

| Метод | Путь | Что делает |
|---|---|---|
| `POST` | `/feedback` | Принимает текст. Под `FeedbackRateLimitGuard`. Создаёт `FeedbackMessage`. Валидация: 1–5000 символов, trim, не пустое после трима. |
| `GET` | `/feedback/my` | Возвращает мои сообщения с пагинацией. Поля: `id`, `text`, `createdAt`, `processedAt`. |
| `GET` | `/feedback/my/limit` | Возвращает `{ usedToday: number, limit: 5, resetAt: ISO8601 }` — фронт показывает «осталось N из 5». |

**Админские эндпоинты** (`/api/v1/admin/feedback`, под `SuperAdminGuard`):

| Метод | Путь | Что делает |
|---|---|---|
| `GET` | `/admin/feedback/topics` | Список блоков с агрегатами. Query: `window=30\|90\|all` (дефолт 30), `q` (поиск по title+description), `includeArchived=false`, `sort=percent\|users\|recent` (дефолт `percent`), `page`, `pageSize`. Возвращает `{ items: [...], totalItemsInWindow, page, pageSize }`. Каждый блок: `id`, `title`, `description`, `status`, `itemsCount`, `uniqueUsersCount`, `percentOfWindow`, `lastItemAt`, `createdAt`. |
| `GET` | `/admin/feedback/topics/:id` | Детали блока + items с пагинацией. Поля item'а: `id`, `text`, `createdAt`, `user: { id, email, name }`, `org: { id, name }`, `messageId`. |
| `GET` | `/admin/feedback/topics/:id/items/:itemId/message` | Полный текст исходного `FeedbackMessage` для разворота. |
| `PATCH` | `/admin/feedback/topics/:id` | Rename: меняет `title` + `description`. |
| `POST` | `/admin/feedback/topics/:sourceId/merge` | Body: `{ targetId }`. В транзакции: все items source перевешиваются на target; source → `status=MERGED`, `mergedIntoId=target`. |
| `POST` | `/admin/feedback/topics/:id/archive` | Меняет `status=ARCHIVED`, `archivedAt=now()`. |
| `POST` | `/admin/feedback/topics/:id/unarchive` | Возвращает `status=ACTIVE`, `archivedAt=null`. |
| `POST` | `/admin/feedback/digest/run` | Ручной запуск ночного прогона (для отладки и форс-обработки). Enqueue job'а в BullMQ. |
| `GET` | `/admin/feedback/messages/failed` | Список `FeedbackMessage` с `failedRuns >= 3` — для ручного разбора. |

Все DTO — через `nestjs-zod`, `@ApiOperation` на эндпоинтах, multi-tenancy не требуется (фидбэк глобальный), но `orgId` пишем при отправке для контекста.

**Rate-limit** (`FeedbackRateLimitGuard`):
- Ключ: `feedback:ratelimit:{userId}:{YYYY-MM-DD-UTC}`
- `INCR` + `EXPIRE 90000` (25 часов).
- Если >5 — кидает `ThrottlerException` 429 с понятным сообщением «Лимит 5 сообщений в сутки исчерпан. Следующая отправка доступна в 00:00 UTC».

**Сервис `feedback-digest.service.ts`** — основная логика ночного прогона:

```ts
async runDigest(): Promise<DigestResult> {
  // 1. Собрать все FeedbackMessage с processedAt=null AND failedRuns<3
  const messages = await this.prisma.feedbackMessage.findMany({
    where: { processedAt: null, failedRuns: { lt: 3 } },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE, // 1000 для старта, переменная окружения
  });
  if (messages.length === 0) return { skipped: true };

  // 2. Загрузить все ACTIVE FeedbackTopic
  const topics = await this.prisma.feedbackTopic.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, title: true, description: true },
  });

  // 3. Вызвать агента (с fallback-цепочкой через LlmRouterService)
  const agentInput = {
    messages: messages.map(m => ({ id: m.id, userId: m.userId, createdAt: m.createdAt.toISOString(), text: m.text })),
    existingTopics: topics,
  };
  const agentOutput = await this.callAgentWithFallback(agentInput);
  // agentOutput валидируется по Zod-схеме (см. ниже)

  // 4. Транзакционно сохранить
  await this.prisma.$transaction(async (tx) => {
    // 4a. Создать новые topics (tempId → реальный id)
    const tempIdToRealId = new Map<string, string>();
    for (const nt of agentOutput.newTopics) {
      const created = await tx.feedbackTopic.create({
        data: { title: nt.title, description: nt.description },
      });
      tempIdToRealId.set(nt.tempId, created.id);
    }
    // 4b. Создать items
    for (const a of agentOutput.assignments) {
      for (const item of a.items) {
        const isDiscard = item.topicRef === 'discard';
        const topicId = isDiscard
          ? null
          : tempIdToRealId.get(item.topicRef) ?? item.topicRef;
        await tx.feedbackItem.create({
          data: {
            messageId: a.messageId,
            topicId,
            text: item.text,
            discarded: isDiscard,
            discardReason: isDiscard ? 'agent_marked' : null,
          },
        });
      }
    }
    // 4c. Пометить сообщения обработанными
    await tx.feedbackMessage.updateMany({
      where: { id: { in: messages.map(m => m.id) } },
      data: { processedAt: new Date() },
    });
  });

  return { processed: messages.length, newTopics: agentOutput.newTopics.length };
}
```

**Логика fallback-цепочки** в `callAgentWithFallback`:
1. Получить чейн моделей из БД по taskType `feedback.cluster` (используем существующий `LlmRouterService`).
2. Попытка 1: primary модель (DeepSeek V4 Pro), JSON-режим.
3. Попытка 2: та же primary с дополнением «верни строго по схеме».
4. Если опять провал — следующая модель из чейна. Повторяем шаги 2–3 для неё (одна попытка с retry-сообщением).
5. Если все модели исчерпаны — `failedRuns++` для всех сообщений батча, throw — следующий cron подхватит.
6. Логирование: каждая попытка → `pino` с `model`, `attempt`, `parseError` если есть.

**Лимит на новые блоки за прогон** — в промпте, плюс программный sanity-check: если `newTopics.length > assignments.flatMap(items).length * 0.5` — это явная аномалия, помечаем батч failed и эскалируем.

### BullMQ-воркер

Файл: `backend/src/workers/jobs/feedback-digest.processor.ts`.

```ts
@Processor('feedback-digest')
export class FeedbackDigestProcessor {
  @Process('run')
  async run() {
    return this.feedbackDigestService.runDigest();
  }
}

// Cron в backend/src/workers/crons/feedback-digest.cron.ts:
@Cron('0 1 * * *', { timeZone: 'UTC' }) // каждый день 01:00 UTC
async scheduleDigest() {
  await this.feedbackQueue.add('run', {}, { jobId: `digest-${Date.now()}` });
}
```

Воркер регистрируется в `backend/src/workers/main.ts` (отдельный процесс — см. CLAUDE.md).

### Промпт агента

**Файл**: `backend/src/modules/feedback/prompts/feedback-cluster.prompt.ts`.

**Registry key**: `feedback.cluster` (admin-editable по правилам skill `z-ai-agent-rules`, code-fallback внутри файла).

**Системный промпт** (черновик, дорабатывается):

```
Ты обрабатываешь обратную связь от пользователей продукта.

ВХОД (JSON):
- messages: массив сообщений { id, userId, createdAt, text }
- existingTopics: массив существующих смысловых блоков { id, title, description }

ЗАДАЧА (выполни внутри одного ответа, обе части):

1) Раздели каждое сообщение на отдельные смысловые тезисы.
   Один пользователь в одном сообщении может высказать несколько разных тем — разнеси их.
   Пример: «дайте тёмную тему и почините экспорт» = 2 тезиса.

2) Каждый тезис привяжи либо к одному из existingTopics (по смыслу, не по словам),
   либо создай новый блок, если ни один существующий не подходит.

ПРАВИЛА:
- Один тезис идёт ровно в один блок.
- Тональность (жалоба, запрос, благодарность) — НЕ отдельное измерение, она часть смысла.
  Пример: «спасибо за дашборд директора» → блок «Благодарности за дашборд директора».
  Пример: «кнопка экспорта виснет» → блок «Проблемы с кнопкой экспорта».
- Новый блок создавай ТОЛЬКО ЕСЛИ:
  (a) 2+ тезиса в этом батче не подходят ни в один existingTopic, ИЛИ
  (b) тезис явно про принципиально новую тему.
  Иначе ищи ближайший существующий блок.
- Если в этом батче уже создал tempId под эту тему — переиспользуй его, не плоди дубль.
- Если тезис — мусор (нечитаемый текст, спам, оффтоп) — поставь topicRef "discard".

ВЫХОД (строго этот JSON, ничего лишнего):
{
  "newTopics": [
    { "tempId": "new_1", "title": "...", "description": "..." }
  ],
  "assignments": [
    {
      "messageId": "msg_1",
      "items": [
        { "text": "тезис как ты его понял", "topicRef": "t_2" }
      ]
    }
  ]
}

topicRef = либо id из existingTopics, либо tempId из newTopics, либо строка "discard".
title нового блока — короткий (до 80 символов), description — 1–2 предложения, что туда попадает.
```

**Zod-схема** для валидации ответа:

```ts
const TopicRefSchema = z.string().min(1);
const NewTopicSchema = z.object({
  tempId: z.string().regex(/^new_\d+$/),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
});
const AssignmentItemSchema = z.object({
  text: z.string().min(1).max(2000),
  topicRef: TopicRefSchema,
});
const AssignmentSchema = z.object({
  messageId: z.string(),
  items: z.array(AssignmentItemSchema),
});
export const FeedbackClusterOutputSchema = z.object({
  newTopics: z.array(NewTopicSchema),
  assignments: z.array(AssignmentSchema),
});
```

Дополнительная проверка после Zod: каждый `topicRef` либо `"discard"`, либо существует в `existingTopics` (по `id`), либо в `newTopics` (по `tempId`); каждый `messageId` присутствовал во входе.

### LLM-router и админка

Добавить новый `taskType` `feedback.cluster` в `LlmTaskRoute`:
- `dataClass`: `internal-feedback` (новый тип данных — фидбэк пользователей; не выпускать наружу).
- Primary: `deepseek-v4-pro`.
- Fallback-цепочка по умолчанию (через seed-скрипт): `deepseek-v4-pro → gpt-5.4 (через OpenAI-proxy) → kie → grsai`.
- Параметры: `temperature: 0.2`, `response_format: { type: 'json_object' }`, `max_tokens: 8000`.

**Страница `/admin/llm-routes`** уже есть (см. свежие коммиты `b8547c1`, `da76fba`) — там в выпадайке будет новый taskType `feedback.cluster`, и админ сможет настроить чейн через тот же UI.

### Frontend — пользовательский

**Маршрут**: `/feedback` в группе `(authenticated)`.

**Сайдбар**: добавить пункт «Ваши предложения» с иконкой (например, лампочка). Виден всем аутентифицированным. Не показывать гостям (они не входят в `(authenticated)` группу).

**Страница `/feedback`** — компоненты:

```
frontend/src/app/(authenticated)/feedback/
  page.tsx                    # сервер-компонент с заголовком
  components/
    FeedbackForm.tsx          # textarea + кнопка + индикатор «осталось N из 5»
    FeedbackHistory.tsx       # таблица «дата | текст | статус»
```

**FeedbackForm.tsx**:
- textarea (5–10 строк, max 5000 симв., счётчик символов).
- Кнопка «Отправить», disabled пока пусто.
- Над формой плашка: «Сегодня вы отправили 2 из 5 сообщений. Следующая возможность завтра.»
- Подпись к textarea: «Напишите, чего вам не хватает в Z. Какие функции вы хотите? Что не нравится? Что нравится? Любая обратная связь поможет нам сделать продукт лучше.»
- После отправки: показать toast «Спасибо, передали команде» + обновить историю + обновить счётчик.
- Если 429 — показать toast «Лимит 5 в сутки исчерпан, попробуйте завтра» и заблокировать форму.

**FeedbackHistory.tsx**:
- Колонки: «Дата», «Текст» (обрезаем до 200 симв. + развернуть), «Статус» (плашка «получено» — серая; в фазе 2 здесь будут другие статусы).
- Сортировка по `createdAt` убыв.
- Пагинация — стандартная Z (limit + offset).
- Пустое состояние: «Вы пока не отправляли предложений».

**API-слой** (`frontend/src/api/feedback.api.ts`):
- `submitFeedback(text: string): Promise<FeedbackMessageDto>`
- `getMyFeedback(page, pageSize): Promise<Paginated<FeedbackMessageDto>>`
- `getMyFeedbackLimit(): Promise<{ usedToday, limit, resetAt }>`

**Domain-модель** (`frontend/src/domain/feedback.ts`):
- `FeedbackMessage` (id, text, createdAt: Date, processed: boolean).
- Маппер из ApiDto.

**SWR-хуки** в компонентах для загрузки истории и лимита.

### Frontend — админский (super-admin Z)

**Маршрут**: `/admin/feedback`, в группе `(admin)`. Доступ только под `SuperAdminGuard` (на backend) и проверкой роли в `EntitlementContext` (фронт).

**Структура**:

```
frontend/src/app/(admin)/admin/feedback/
  page.tsx                          # дашборд блоков
  [topicId]/page.tsx                # детали блока
  components/
    TopicsTable.tsx                 # таблица блоков
    TopicsFilters.tsx               # окно 30/90/all + поиск + showArchived
    TopicDetail.tsx                 # заголовок блока + действия
    TopicItemsList.tsx              # список items с автором/датой
    ItemRow.tsx                     # одна строка item'а + разворот сообщения
    TopicActionsMenu.tsx            # rename / merge / archive дропдаун
    RenameTopicDialog.tsx
    MergeTopicDialog.tsx            # выбор target из активных блоков
    ArchiveTopicDialog.tsx          # confirm
```

**Дашборд `/admin/feedback`** (page.tsx):
- Шапка: «Обратная связь пользователей» + кнопка «Запустить обработку сейчас» (POST на `/admin/feedback/digest/run`).
- Фильтры: переключатель окна `[30 дней | 90 дней | За всё время]`, поисковая строка, чекбокс «Показывать архивированные».
- Метрика наверху: «За выбранный период: N сообщений от M пользователей, K смысловых блоков».
- Таблица:

| Тема | Описание | Items | Юзеров | % | Последнее | Действия |
|---|---|---|---|---|---|---|
| Тёмная тема | Запросы на переключатель свет/тьма | 47 | 23 | 9.4% | 2 дня назад | ⋯ |

  - Колонки сортируемые (по умолчанию `%` убыв.).
  - Архивированные подсвечены серым + значок 🗄.
  - Клик по строке → переход на `/admin/feedback/[topicId]`.
- Пагинация: 20 блоков на страницу.

**Страница блока `/admin/feedback/[topicId]`**:
- Заголовок: title + description (редактируемые через диалог Rename).
- Кнопки действий: «Переименовать», «Объединить с…», «В архив» / «Восстановить».
- Метрики: items count, unique users, % от окна (с тем же переключателем 30/90/all).
- Список items, отсортированный по `createdAt` убыв., с пагинацией:

| Дата | Пользователь | Орг | Тезис | Развернуть |
|---|---|---|---|---|
| 2026-05-25 14:00 | user@example.com (Иван) | ООО Ромашка | «хочу тёмную тему» | ▼ |

  - При клике на ▼ — раскрывается полный текст исходного `FeedbackMessage` (грузится отдельным запросом).
- Группировка опц.: чекбокс «Группировать по пользователю» — показывает кто сколько раз писал в этот блок.

**Диалоги действий**:
- **Rename**: два поля (title до 120 симв., description до 500 симв.). PATCH на эндпоинт.
- **Merge**: автокомплит по активным блокам → выбираем target → confirm «N items будут перенесены в '...'. Этот блок будет помечен как объединённый». POST на эндпоинт.
- **Archive/Unarchive**: confirm «Блок будет скрыт из дефолтных списков, items сохранятся». POST.

**API-слой** (`frontend/src/api/admin-feedback.api.ts`) — соответствующие методы, тонкая обёртка над эндпоинтами выше.

### Промпт в админке `/admin/llm-routes`

- Новый taskType `feedback.cluster` появится в дропдауне.
- Админ может править системный промпт и менять fallback-цепочку из выпадайки моделей.
- Изменения сразу применяются к следующему ночному прогону.

## Критерии готовности (DoD)

- [ ] Schema `prisma/schema.prisma` обновлена; `bun run prisma:push` прошёл; `bun run prisma:generate` сделан.
- [ ] Все эндпоинты задокументированы в Swagger (`/api/docs`), DTO через `nestjs-zod`.
- [ ] Rate-limit 5/UTC-сутки работает (юнит-тест на guard + интеграционный на эндпоинт).
- [ ] Юнит-тесты на `feedback-digest.service`:
  - корректный батч → новые topics + items + processedAt.
  - сломанный JSON → retry → fallback → восстановление.
  - все модели упали → `failedRuns++`, сообщения остаются unprocessed.
  - `topicRef` ссылается на несуществующий id → batch failed.
  - `merge` topic'а: items source перевешиваются на target в транзакции.
- [ ] Юнит-тест на промпт + Zod-схема: фикстура входа → ожидаемый выход проходит валидацию.
- [ ] BullMQ-cron зарегистрирован в `workers/main.ts`, ручной запуск через `/admin/feedback/digest/run` работает.
- [ ] Frontend `/feedback` собирается, форма отправляет, история отображается, счётчик лимита корректный.
- [ ] Frontend `/admin/feedback` собирается, дашборд показывает блоки, фильтры/сортировка работают, drill-down открывает детали.
- [ ] Действия rename / merge / archive работают через UI.
- [ ] `bunx tsc --noEmit` зелёный в backend и frontend.
- [ ] `bun run build` зелёный в backend и frontend.
- [ ] Seed-скрипт добавляет дефолтную fallback-цепочку для `feedback.cluster` в `LlmTaskRoute`.
- [ ] Second-brain обновлён:
  - `01_projects/feedback.md` (новая заметка)
  - `02_architecture/data-model.md` (новые таблицы)
  - `02_architecture/module-map.md` (новый модуль)
  - `01_projects/ai-jobs.md` (новый job `feedback-digest`)
  - `01_projects/workers-queues.md` (новая очередь)
  - `01_projects/admin.md` (новая админ-страница)
  - `01_projects/api-layer.md` (новые эндпоинты)
  - `01_projects/frontend-pages.md` (новая публичная страница `/feedback`)
  - `index.md` — ссылка на новый проектный файл.

## Риски и ограничения

- **Шум на старте**: первые недели агент может создавать много почти-дублирующихся блоков. Митигация — операторские действия merge + жёсткое правило в промпте «создавай новый только если 2+ тезиса не лезут».
- **Стоимость LLM**: при 100 сообщениях в день батч ~30–50K токенов. На DeepSeek V4 Pro — копейки. Если объём вырастет до 10K/день — нужно бить на под-батчи (фиксируем как риск, не решаем в MVP).
- **Изменение блоков между прогонами**: оператор переименовал блок → агент видит новое название → может перестать туда складывать (если description расходится с title). Митигация — в админке предупреждать «переименование изменит логику кластеризации, лучше также скорректировать description».
- **Размер existingTopics**: при 200+ блоках промпт раздуется. Зафиксировано как фаза 2 (embedding-предфильтр), но MVP-запас по DeepSeek V4 Pro контексту покрывает ~500 блоков.
- **Один и тот же тезис в нескольких блоках**: по контракту нельзя. Если агент захочет — отбросим (правило «один тезис — один блок» в промпте).
- **Удаление пользователя**: `onDelete: Cascade` на `FeedbackMessage` — items тоже исчезнут, проценты в дашборде поедут вниз. Альтернатива (анонимизация вместо удаления) — фаза 2, как часть GDPR-работы.
- **Параллельный запуск двух cron'ов**: BullMQ с `jobId` гарантирует один in-flight job на тот же ключ; ручной запуск использует другой jobId — теоретически может пересечься с ночным. Митигация — внутри `runDigest` использовать Redis-lock `feedback:digest:lock` с TTL 30 минут.

## Фазы реализации

- [x] **Фаза 1 — БД и backend-каркас.** Prisma-модели + push + generate. Каркас модуля `feedback` (controller + service stubs + DTO). Никаких эндпоинтов с логикой пока. `bunx tsc --noEmit` зелёный.  
  _Сделано: модели в `schema.prisma` (FeedbackMessage/Topic/Item + enum + back-rel в User/Org), модуль `backend/src/modules/feedback/` с 15 файлами, переиспользован существующий `auth/guards/super-admin.guard.ts`. tsc по feedback-коду чистый. `prisma:push` отложен — Docker не запущен; будет применён в Фазе 10._
- [x] **Фаза 2 — Пользовательские эндпоинты и rate-limit.** `POST /feedback`, `GET /feedback/my`, `GET /feedback/my/limit`. `FeedbackRateLimitGuard` с Redis. Юнит-тесты на guard и сервис. Swagger.  
  _Сделано: `feedback.service.ts` (submit/listMine/getLimit), `feedback-user.controller.ts` (3 эндпоинта + Swagger), `feedback-rate-limit.guard.ts` (INCR+EXPIRE pipeline, UTC-ключ, 429 с русским сообщением, fail-open при Redis-сбое). 17 unit-тестов (9 service + 8 guard). orgId через `X-Org-Id`-заголовок._
- [x] **Фаза 3 — Frontend пользовательский.** `/feedback` страница, форма, история, счётчик лимита. Проверить ручками в браузере.  
  _Сделано: `frontend/app/(authenticated)/feedback/` (page.tsx + FeedbackForm.tsx + FeedbackHistory.tsx), `src/api/feedback.api.ts`, `src/domain/feedback.ts` + 8 unit-тестов мапперов. Sidebar обновлён (`MessageCircle` иконка, ссылка `/feedback`). SWR для data-fetching, Sonner для toast. Ручная проверка в браузере — Phase 10._
- [x] **Фаза 4 — Промпт + LLM-router taskType.** Добавить `feedback.cluster` в registry. Seed fallback-цепочки. Zod-схема валидации. Юнит-тест с фикстурой.  
  _Сделано: `feedback-cluster.prompt.ts` (системный промпт + Zod `FeedbackClusterOutputSchema` + ref-валидатор `validateFeedbackClusterReferences` + user-template + LLM-params), 15 prompt-тестов. В `llm-router.service.ts` добавлен `feedback.cluster` в `LlmTaskType` + `ALL_LLM_TASK_TYPES`. Seed `backend/scripts/seed-llm-task-routes-feedback-cluster.ts` (идемпотентный, защита `editedByAdmin`). dataClass = `internal` (отдельный `internal-feedback` потребовал бы миграцию enum — отложено). Fallback-цепочка: deepseek-v4-pro → openai-via-proxy/gpt-5.4 → kie/gemini-3-pro → grsai/gemini-3-pro._
- [x] **Фаза 5 — Digest-сервис + воркер + cron.** `feedback-digest.service.ts` с реальной логикой, fallback по моделям, транзакция. BullMQ-processor, cron 01:00 UTC. Redis-lock. Юнит + интеграционные тесты. Ручной запуск через `/admin/feedback/digest/run`.  
  _Сделано: `feedback-digest.service.ts` (Redis-lock SETNX EX 30 мин → batch unprocessed (failedRuns<3, default 1000) → ACTIVE topics → LlmRouterService.call (router сам перебирает fallback-цепочку) + 2 попытки retry с приписанным «верни строго JSON по схеме» → Zod + ref-валидация → sanity (newTopics ≤ 0.5 × items) → транзакция: создать topics, items с tempId→realId, processedAt=now → освободить lock). При провале — failedRuns++ через updateMany. Воркеры (Queue/Worker/Cron @Cron('0 1 * * *', UTC)) живут в-процесс в `backend/src/modules/feedback/workers/` (паттерн Z, отдельного workers/main.ts нет). controller'у заменён stub /digest/run на enqueueManualRun. 10 unit-тестов digest._
- [x] **Фаза 6 — Админские эндпоинты.** GET список/детали блоков, GET items, PATCH rename, POST merge / archive / unarchive. Swagger. Юнит-тесты.  
  _Сделано: `feedback-admin.controller.ts` — все маршруты кроме `POST /digest/run` (явный `NotImplementedException` для Phase 5). `feedback.service.ts` пополнен admin-фасадами (listTopics, getTopicDetails, getTopicItems, getMessageById, listFailedMessages). `feedback-topic-manager.service.ts` — listTopics с агрегатами + 8 mutation-методов (rename, merge с транзакцией, archive, unarchive). Подсчёт через 4 SQL-запроса: Prisma groupBy + raw distinct count + counts; sort/pagination в JS (топиков сотни). 47 новых тестов (15 service + 32 topic-manager). DTO для failed messages и topic detail query._
- [x] **Фаза 7 — Frontend админский.** `/admin/feedback` дашборд, фильтры, таблица. `/admin/feedback/[topicId]` детали, items, разворот сообщения.  
  _Сделано: `frontend/app/(authenticated)/admin/feedback/` — page.tsx (дашборд), FeedbackDashboardClient.tsx, [topicId]/page.tsx + FeedbackTopicDetailClient.tsx, components/ (TopicsFilters, TopicsTable, TopicDetail, TopicItemsList, ItemRow). API-слой `src/api/admin-feedback.api.ts` (9 эндпоинтов, включая mutations Phase 8 — готовы к подключению). DomainModel `src/domain/admin-feedback.ts` + 22 unit-теста. Navigation entry `/admin/feedback` (MessageCircle) добавлен в категорию «Платформа» админского `navigation.ts`. Кнопка «Запустить обработку сейчас» вызывает POST /digest/run и обрабатывает 501 (Phase 5). Phase 8 действия (rename/merge/archive) — placeholder через `alert()`. Sonner для toast, SWR для data-fetching._
- [x] **Фаза 8 — Действия в админке.** Диалоги rename / merge / archive, кнопка «Запустить обработку сейчас». Ручная проверка флоу.  
  _Сделано: 3 диалог-компонента (RenameTopicDialog, MergeTopicDialog, ArchiveTopicDialog с режимом archive/unarchive через prop). Radix Dialog (`ui/shadcn/dialog`), per-component useState. Подключены к `adminFeedbackApi.{rename,merge,archive,unarchive}Topic` через `FeedbackDashboardClient` и `FeedbackTopicDetailClient`. SWR mutate + Sonner toast. Merge target загружается из `listTopics({window:'all', sort:'recent'})`, source исключён. 9 unit-тестов диалогов проходят. Кнопка «Запустить обработку» — уже была в Phase 7, работает с Phase 5 endpoint._
- [x] **Фаза 9 — Second-brain и наблюдаемость.** Заполнить все заметки в second-brain. Добавить prom-метрики `feedback_digest_runs_total`, `feedback_digest_messages_processed`, `feedback_digest_new_topics`, `feedback_digest_failed_runs`. Логи через `pino` с structured-полями.  
  _Сделано: `BusinessMetricsService` пополнен 4 Counter'ами + inc-методами. `feedback-digest.service.ts` инкрементирует на каждом исходе (success/skipped/lock_held/agent_failed/anomaly/txn_failed) + расширены structured-логи (`lockKey, batchSize, topicsCount, newTopicsCreated, itemsCreated, discardedCount, result`). markBatchFailed считает сообщения с `failedRuns≥3` и инкрементирует `feedback_digest_failed_runs_total`. Spec обновлён через `makeMetrics()` stub — 80 тестов всё ещё проходят. Second-brain: создан `01_projects/feedback.md`, обновлены `index.md` + `02_architecture/{data-model,module-map}.md` + `01_projects/{ai-jobs,workers-queues,admin,api-layer,frontend-pages}.md`._
- [ ] **Фаза 10 — Прод-чеклист.** Применить миграцию схемы на проде (`prisma db push`), пушнуть seed `feedback.cluster` route, проверить, что cron поднялся в воркере, отправить тестовый фидбэк, дождаться 01:00 UTC, убедиться в обработке.

## Итог

_Заполняется по факту: реализовано целиком или нет, что осталось._
