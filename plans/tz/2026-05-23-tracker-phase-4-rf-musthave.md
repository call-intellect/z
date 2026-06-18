---
type: tz
status: partial
feature: Таск-трекер Z/Кора — Фаза 4 — РФ must-have (Telegram-бот для задач, email-to-task, 10-15 шаблонов команд, локализация)
date: 2026-05-23
phase: 4 / 6
parent: plans/archive/2026-05-23-tracker-phase-1-models-api.md
---

# Фаза 4 трекера: РФ must-have

## TL;DR

Российский слой: **Telegram-бот для задач** (уведомления + создание текстом и голосом + forward + утренний дайджест), **email-to-task** (уникальный адрес проекта), **10-15 готовых шаблонов команд** (продажи / разработка / монтаж / маркетинг / управление / поддержка / HR / финансы / ...). Полная локализация терминов на русский. Срок: 4 человеко-недели.

## Зависимости

- **Фаза 1-2 трекера** — модели + UI готовы.
- **α-1 ConversationalChannels** — Telegram адаптер готов (после β-1 zero-button rip-out).
- **β-1 Telegram + MAX zero-button** — должен быть применён, чтобы не пересекаться со старыми callback_query.
- **mail-модуль** — для inbound email через IMAP (расширение).

## Telegram-бот для задач

### 5 ключевых сценариев

#### 1. Уведомление о назначении задачи + дедлайне

При событиях:
- Issue.assignees добавлен пользователь
- Issue.dueDate приближается (cron `0 9 * * *` — за день до дедлайна и в день дедлайна)
- Issue.status changed → blocked / waiting / urgent

Бот шлёт сообщение в Telegram:
```
🔵 Новая задача: KORA-123
«Подготовить макет лендинга»
Срок: завтра, 15:00
Проект: Команда маркетинга
```

С inline-кнопками **только декларативно через структурированный текст** (не используем `inline_keyboard` — это противоречит β-1 zero-button принципу). Вместо кнопок — короткие команды текстом, которые бот понимает:
- Reply «принял» → меняет статус на `in_progress`
- Reply «+1 день» → передвигает dueDate
- Reply «не сделаю» → ставит в backlog

#### 2. Создание задачи одной фразой

Пользователь пишет боту в личке:
```
Иванов, завтра в 15, объект Тверская — замерить и привезти расчёт
```

Бот через **LLM-парсер `telegram-create-task`**:
- Извлекает: title, suggestedAssignee, suggestedDueDate, suggestedProject (по контексту пользователя).
- Создаёт `IntakeIssue` с `source='telegram'`.
- Авто-triage (Фаза 3): если confidence ≥ 0.85 → создаёт Issue сразу.
- Отвечает пользователю: «✅ Задача создана: TVERSKAYA-15 «Замерить и привезти расчёт по объекту Тверская», исполнитель Иванов, срок 24.05 15:00. [ссылка]»

#### 3. Комментарий к задаче из ответа

Когда бот шлёт уведомление о задаче (сценарий 1), пользователь может ответить (reply) на это сообщение в Telegram. Текст ответа → создаётся `IssueComment` в этой задаче. Если ответ — голосовое, ASR → текст.

#### 4. Forward сообщения → задача

Forward любого сообщения из любого чата боту:
- LLM-парсер `telegram-forward-to-task` извлекает суть.
- Создаётся `IntakeIssue` с `source='telegram_forward'`, `rawContent` = forwarded text.
- Auto-triage предлагает project/assignee.
- Если confidence ≥ 0.85 → авто-Issue, иначе → в `/intake`.

#### 5. Утренний digest

Cron `0 9 * * *` для каждого пользователя:
- Бот шлёт сводку:
  ```
  ☀️ Доброе утро! У тебя сегодня:
  
  🔥 Срочно (1):
  • KORA-123 «Подготовить макет» — срок сегодня 15:00
  
  📋 В работе (3):
  • KORA-119 «Дизайн админки»
  • KORA-120 «...»
  
  ⏰ Просрочены (1):
  • KORA-110 «Согласовать договор» — на 2 дня
  ```

### Голосовой ввод (наш USP — никто из РФ-трекеров не делает)

В Telegram прислал голосовое (`message.voice`):
1. Backend получает file через Telegram API.
2. ASR через Vox/GigaAM (уже есть в системе).
3. Транскрипт → как обычный текст → LLM-парсер → создание задачи или комментарий.

### LlmTaskType (новые)

- `telegram-create-task` (primary DeepSeek, secondary gpt-4o-mini, tertiary qwen3.5:9b)
- `telegram-forward-to-task` (то же)
- `telegram-reply-classify` (определяет: команда статуса / комментарий / новое — primary qwen3.5:9b — это быстрая классификация)
- `telegram-digest-formulate` (primary DeepSeek, формулирует тёплый дайджест)

## Email-to-task

### Архитектура

- Каждому Project выдаётся уникальный email: `proj-{tenantSlug}-{projectIdentifier}@inbox.kora.app` (через mail-модуль с IMAP / поддоменом).
- Сообщение на этот адрес:
  1. mail-сервис принимает.
  2. Создаётся `IntakeIssue` с `source='email'`, `sourceEmail=from_address`, `rawContent=subject+body`.
  3. Вложения → файлы Issue после создания.
  4. Auto-triage предлагает поля.
  5. Reply на email с уведомлением → IssueComment.

### UX

- В `/projects/[slug]/settings` — блок «Email-to-task»: показ адреса проекта + копирование.
- В `/intake` — карточка с пометкой «📧 Email от {from_address}».

### Безопасность

- Источник проверяется по `sourceEmail` — если адрес в `Org.allowedEmails` → авто-доверие. Иначе → требует ручного триажа.
- Спам-фильтр на уровне mail-сервиса (`@plane/spam-protection` или внутренний).

## 10 шаблонов команд (Team Templates)

### Структура каждого шаблона (JSON)

```json
{
  "slug": "sales",
  "name": "Команда продаж",
  "description": "Шаблон для отделов продаж и работы с клиентами",
  "category": "sales",
  "definition": {
    "roles": [
      { "key": "head_of_sales", "name": "Руководитель отдела", "responsibilities": [...] },
      { "key": "account_manager", "name": "Менеджер по работе с клиентами", "responsibilities": [...] },
      { "key": "sales_ops", "name": "Координатор продаж", "responsibilities": [...] }
    ],
    "states": [
      { "name": "Новый лид", "category": "backlog", "color": "#94A3B8" },
      { "name": "В работе", "category": "started", "color": "#3B82F6" },
      { "name": "Согласование", "category": "started", "color": "#F59E0B" },
      { "name": "Сделка", "category": "completed", "color": "#10B981" },
      { "name": "Не дошёл", "category": "cancelled", "color": "#EF4444" }
    ],
    "typicalTasks": [
      { "title": "Первый звонок с лидом", "stateKey": "in_progress", "estimatePoints": 1 },
      { "title": "Презентация продукта", "stateKey": "in_progress", "estimatePoints": 2 },
      { "title": "Подготовка КП", "stateKey": "approval", "estimatePoints": 3 }
    ],
    "regulationStubs": [
      "Регламент обработки входящих лидов",
      "Скрипт первого звонка",
      "Шаблон коммерческого предложения"
    ],
    "kpiTemplates": [
      { "name": "Конверсия из лида в сделку", "frequency": "monthly" },
      { "name": "Средний чек", "frequency": "monthly" }
    ]
  },
  "isPublic": true
}
```

### Список 10 шаблонов (стартовый набор)

| Slug | Название | Категория | 3-5 ролей | Цель |
|---|---|---|---|---|
| `sales` | Команда продаж | sales | Руководитель / Менеджер по работе с клиентами / Координатор | Воронка лидов |
| `development` | Команда разработки | development | Тимлид / Разработчик / Тестировщик / DevOps | Спринты, релизы |
| `installation` | Команда монтажа и сервиса | services | Диспетчер / Бригадир / Мастер | Заявки от клиентов, выезды |
| `marketing` | Команда маркетинга | marketing | Маркетолог / SMM / Дизайнер / Копирайтер | Контент-план, кампании |
| `management` | Управленческая команда | management | Главный руководитель / Руководители отделов | Стратегические задачи |
| `customer_support` | Команда поддержки клиентов | support | Руководитель поддержки / Агент | Тикеты клиентов |
| `hr` | Команда HR | hr | Руководитель HR / Рекрутер / HR-партнёр | Найм, онбординг, развитие |
| `finance` | Финансовая команда | finance | Финансовый директор / Бухгалтер / Финансовый аналитик | Закрытие месяца, бюджет |
| `operations` | Операционная команда | operations | Операционный директор / Координаторы | Ежедневное управление |
| `product` | Продуктовая команда | product | Продакт / Дизайнер / Аналитик | Гипотезы, MVP, метрики |

### Дополнительные 5 опциональных шаблонов (заложить, поставить в seed `isPublic=false`, активировать по запросу клиента)

- `quality_control` — Команда контроля качества
- `legal` — Юридическая команда
- `procurement` — Закупки
- `logistics` — Команда логистики
- `events` — Команда событий и PR

### Где живут шаблоны

- **Системные** (`tenantId = null`, `isPublic = true`) — в seed через `backend/scripts/seed-team-templates.ts` (one-off по safe-seed-rules).
- **Кастомные** (`tenantId = X`) — главный администратор создаёт через `/admin/team-templates/new` с конструктором.

### Создание проекта из шаблона

`POST /projects/from-template`:
1. Принимает: `templateSlug`, `name`, `identifier`.
2. Создаёт Project.
3. Создаёт все states по definition.
4. Создаёт `regulationStubs` как пустые `Regulation` с `status='draft'` (для α-7 регламентов).
5. Создаёт `kpiTemplates` как пустые KPI (после α-8).
6. Опционально создаёт 2-3 typicalTasks как примеры (если флаг `withExampleTasks=true`).
7. Возвращает Project.

## Локализация — финальный проход

### Что добавляется в Фазе 4

- Тщательная вычитка всех строк (по правилу `admin_ui_russian_only`).
- Согласование терминов из словаря (см. Фаза 2) с реальным контентом.
- Производственный календарь РФ — праздничные дни загружаются в БД (`HolidayCalendar` модель), учитываются в dueDate / cycle.endDate (если задача попадает на праздник — авто-перенос на следующий рабочий день).

### `HolidayCalendar`

```
model HolidayCalendar {
  id          String   @id @default(cuid())
  tenantId    String?              // null = глобальный РФ-календарь (платформенный)
  date        DateTime
  name        String              // «Новый год», «8 марта», ...
  isWorking   Boolean  @default(false) // true для перенесённых рабочих суббот
  
  @@unique([tenantId, date])
}
```

Seed `backend/scripts/seed-holiday-calendar-ru.ts` — производственный календарь на текущий год (обновляется ежегодно).

## Метрики Prometheus

```
telegram_tasks_created_total{tenant}
telegram_voice_transcribed_total{tenant}
telegram_forwards_total{tenant}
telegram_digest_sent_total{tenant}
email_to_task_total{tenant}
team_template_used_total{tenant, slug}
```

## DoD

- [x] Telegram-бот реализует 5 сценариев + голосовой ввод
- [x] 4 новых LlmTaskType с тройной цепочкой
- [ ] Email-to-task работает: уникальный адрес проекта, прием через IMAP, IntakeIssue создаётся
- [x] 10 системных шаблонов команд в seed, `POST /projects/from-template` работает
- [x] Производственный календарь РФ загружен, dueDate авто-переносится с праздников
- [x] Все строки UI на русском, по словарю
- [x] Метрики Prometheus
- [x] Тесты: integration (Telegram-сценарии через mock + e2e email через testcontainer) — кроме email

## Срок

**4 человеко-недели.**

## Следующая фаза

[Фаза 5: Импорт + миграция](2026-05-23-tracker-phase-5-import.md) — Битрикс24, Trello, Я.Трекер.

---

_2026-05-23: российский слой готов — Telegram с голосом, email, 10 шаблонов команд, производственный календарь._

## Ревизия от 2026-05-24

**Статус:** partial
**Реализовано:**
- Telegram-бот для задач: `backend/src/modules/conversational/adapters/telegram-bot/` — `telegram-bot-message.handler.ts`, `telegram-task-parser.service.ts`, `telegram-digest.cron.ts` + 4 LlmTaskType (telegram-create-task, telegram-forward-to-task, telegram-reply-classify, telegram-digest-formulate), голосовой ввод через ASR.
- 5 сценариев Telegram: уведомления + создание фразой + reply-комментарий + forward → задача + утренний digest (cron 09:00 UTC).
- 10 шаблонов команд: `backend/src/modules/tracker/seed/team-templates-data.ts` + `seed-team-templates.ts`; `POST /projects/from-template` через `team-templates.controller.ts`; frontend `FromTemplateWizard.tsx` в `/projects/new`.
- HolidayCalendar модель + seed на 2026 (`holiday-calendar-ru-2026-data.ts`); `HolidayService` интегрирован в `IssuesService` через `dto.respectHolidays` (Agent K) — авто-перенос dueDate.
- TelegramLinkSection в `/settings/integrations` + frontend deep-link.
- Локализация — все строки в новых UI на русском.
- Метрики Prometheus + 41+ тест для Telegram + 16+ для шаблонов/календаря.

**Осталось:**
- **Email-to-task НЕ реализован**: нет mail-сервиса с IMAP/SMTP для приёма писем на `proj-{slug}-{identifier}@inbox.kora.app`, нет UI «Email-to-task» в `/projects/[slug]/settings`, нет генерации уникального адреса проекта, нет обработки вложений из писем.
- AssigneeResolverService и Goal hint в Telegram TASKS_TOOL — частично (Agent B TODO).

**Коммиты:** c8d6ecc, 7c036b0 (Agent D + E + K + L).
