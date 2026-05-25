---
status: snapshot
created: 2026-05-25
type: analysis
purpose: Карта всех LLM-агентов Z с разбиением по архитектуре, триггерам и статусу эмпирической проверки
---

# Карта AI-агентов Z — архитектурный обзор

> Этот документ — **аналитический snapshot** на 2026-05-25 для понимания общей картины. Живой реестр agentов — [second-brain/01_projects/ai-jobs.md](../../second-brain/01_projects/ai-jobs.md). Полный список taskType — `backend/scripts/seed-llm-task-routes-*.ts`.

## TL;DR (в одном экране)

- **Всего около 95 уникальных taskType** (LLM-агентов) в проекте.
- **Около 90 — одиночки** (один вызов = одна работа). Это нормально: большинство задач локальные.
- **Только 3 многошаговые конструкции:**
  - `chat-v2` — 5 шагов диалога (оставляем).
  - `meeting-analyze-v2` — 5 шагов отчёта (legacy, **сворачиваем** в один `meeting-report-fast`).
  - Specialists knowledge-core — 8 параллельных извлекателей сущностей (**сворачиваем** в один `submit_all_8_entities` по паттерну Б+).
- **Проверено эмпирически** (наши 4 эксперимента + golden): около 22 агентов (≈25%).
- **Покрыто архитектурным правилом** (без эмпирики, но решение очевидно): около 50 агентов.
- **Реально не проверено и заслуживает golden** в будущем: 5-7 пользовательских агентов (см. §4).

---

## 1. По АРХИТЕКТУРЕ — одиночки vs цепочки vs параллельные

### 1.1 Одиночки (≈ 90 шт.)

**Что это:** один LLM-вызов, один объект на вход, один структурированный результат на выход.

**Примеры:**
- `block-ingest` — сырой пост-meeting текст → разбиение на IdeaBlock.
- `theme-classify` — кластер блоков → тематика.
- `decision-extract` — блок типа `decision` → запись Decisions Registry.
- `checkin-sentiment` — текст чек-ина → sentiment ∈ {green, yellow, red}.
- `clone-respond` — вопрос + персона + контекст → ответ от имени человека.
- `concierge-respond` — вопрос пользователя → ответ AI-помощника.

**Правило для одиночек (см. §0.3 ТЗ-копилки):** объединять нечего, экономия от объединения нулевая. Применяем DeepSeek-Pro для качества, DeepSeek-flash для простых задач — по существующей маршрутизации.

### 1.2 Многошаговые цепочки (2 шт.)

**`chat-v2`** — 5 синхронных шагов:
1. `contextualize` — переформулировать вопрос с учётом истории.
2. `classify` — определить тип запроса.
3. `multi-query` — сгенерировать 3-5 переформулировок для RAG-поиска.
4. `confidence` — оценить уверенность по найденным блокам.
5. `synthesize`/`answer` — финальный ответ.

> **Эксперимент 2 (наш) подтвердил: оставляем разделённой.** Объединение в один вызов проиграло — нет общего тяжёлого контекста (каждый шаг работает на маленьком входе). См. §2 ТЗ-копилки.

**`meeting-analyze-v2`** — 5 шагов сборки AI-отчёта по встрече:
1. `block-ingest` — транскрипт → IdeaBlocks.
2. `chapter-extract-v2` → главы.
3. `task-extract-v2` → задачи.
4. `summary-v2` → итоговый markdown.
5. `meeting-quality-score` → оценка качества встречи.

> **Эксперимент 1 (наш) показал:** один объединённый вызов `meeting-report-fast` (всё в одном tool-инструменте) выиграл с разгромом — **в 4.6× дешевле, в 3.5× быстрее, лучше глубина**. Старая 5-шаговая цепочка деprecated, заменяется новым taskType. См. §1 ТЗ-копилки.

### 1.3 Параллельные по сути, не цепочка (Specialists knowledge-core)

8 параллельных вызовов на одних и тех же IdeaBlock'ах одной встречи:
- `regulation-extract` (specialist 3-1)
- `knowledge-clone-extract` (3-2)
- `decision-extract` (3-3)
- `department-extract` (3-4)
- `insight-extract` (3-5)
- `idea-extract` (3-6)
- `skill-trait-detect` (3-7)
- `helpfulness-detect` (3-8)
- `experiment-extract` (3-9)

> **Эксперимент 3 (наш):** все 8 заменяются ОДНИМ вызовом `submit_all_8_entities` (Variant Б+) — **в 3.7× дешевле**, лучше качество (когерентность типизации, нет дубликатов). См. §3 ТЗ-копилки.

> **Исключение:** `skill-trait-detect` дополнительно проверен golden-набором (§8 ТЗ-копилки) на смену provider'а — это самый чувствительный из специалистов.

### 1.4 Merge/арбитры (отдельный паттерн)

Не цепочка, но имеет общий шаблон «вторичный вызов после extract'а»:
- `regulation-dedupe` — после `regulation-extract` отдельным `@OnEvent`.
- `decision-supersede-detect` — после `decision-extract`.
- `entity-merge-arbiter` — после resolver'а.
- `knowledge-clone-merge` — после `knowledge-clone-extract`.
- `idea-cluster-merge`, `skill-trait-merge`, `helpfulness-trait-merge`, `insight-link-to-decisions`, `experiment-summarize-lessons`.

**Свойство:** работают на парах кандидатов «новый объект vs существующий из KNN». Маленький вход, маленький выход.

**Не объединяем.** Применяется §0.3: разные малые входы, общего контекста нет.

---

## 2. По ТРИГГЕРУ — когда срабатывает

### 2.1 Cron (планировщик, без явного входа)

| taskType | Расписание | Что делает |
|---|---|---|
| `entity-resolver` | 4ч | Сводит дубликаты Entity. |
| `entity-graph-builder` | 24ч | Пересобирает граф связей. |
| `reframing` | 12ч | Переформулирует устаревшие IdeaBlocks. |
| `idea-status-summarize` | 12ч | Обновляет агрегат по идеям. |
| `skill-trait-concept-name` | 6ч | Эмерджентная нормализация имён категорий. |
| `helpfulness-spotlight-formulate` | 7 д | Недельная подборка взаимопомощи. |
| `role-profile-build` | 24ч | Профиль роли по сотрудникам. |
| `operations-daily-digest` | 6ч | Сводка дня для COO. |
| `operations-weekly-digest` | 1 нед | Сводка недели для COO. |
| `proactive-message-craft` | 6ч | Текст для proactive-уведомлений. |
| `probe-formulate` | 24ч | Формулировка probe-сообщений. |
| `commitment-followup` | 1ч | Поиск просроченных обещаний (cron сам, LLM внутри). |
| `telegram-digest-formulate` | 24ч | Сводка для Telegram-канала. |

### 2.2 Event-driven через BullMQ или `@OnEvent`

**Самая частая группа.** Срабатывает при появлении нового объекта в системе:
- На `meeting.transcribed` → `meeting-analyze-v2` цепочка (или новый `meeting-report-fast`).
- На `meeting.blocks-ready` → специалисты 3.1-3.9 (или новый объединённый Б+).
- На `checkin.created` → `checkin-sentiment`.
- На `recognition.received` → `recognition-formulate`.
- На `telegram.message-received` → `telegram-reply-classify` → `telegram-create-task`.
- На `intake.received` → `intake-auto-triage` (трекер).
- На событиях `*-candidate` после extract'а → merge-арбитры.

### 2.3 Синхронные REST (вызываются пользователем)

| Где | Куда ходит юзер | taskType |
|---|---|---|
| AI-чат компании | `/api/v1/chat-v2/...` | вся цепочка chat-v2 |
| Клон сотрудника | `/api/v1/clones/:id/ask` | `clone-respond` |
| Concierge (главный AI-вход) | `/api/v1/concierge/...` | `concierge-respond`, `concierge-toolcall-validate` |
| Карточки | `/api/v1/cards/.../chat` | `card-chat`, `card-rollup` |
| Перегенерация раздела отчёта | `/api/v1/reports/.../regenerate` | `regenerate-section` |
| Custom-prompt из UI админа | `/api/v1/admin/ai/run-prompt` | `custom-prompt` |
| Operations-сводка по требованию | `/api/v1/operations/summary` | `operations-summary` |
| Orchestrator (внутренний) | `/api/v1/orchestrator/run` | `orchestrator-plan/subagent/synthesize/verify` |
| Transcript-clean при редактуре | `/api/v1/meetings/.../refine` | `transcript-clean-refine` |

---

## 3. По МОДУЛЯМ (где живут)

| Модуль | Грубое число taskType | Чем занимается |
|---|---|---|
| `ai` (legacy) | 10 | Старый AI-pipeline до knowledge-core. Часть устаревает. |
| `knowledge-core` | 35+ | Граф знаний, specialists 3.1-3.9, chat-v2, meeting-report-fast. |
| `operations` | 8-10 | Чек-ины, обещания, дайджесты COO, probes. |
| `tracker` (issue AI) | 3 | Авторазметка тикетов, suggest целей. |
| `conversational` | 4-5 | Telegram-канал, concierge. |
| `recognition` | 1-2 | Формулировка похвалы. |
| `brand-voice` | 1 | Извлечение тона голоса для org. |
| `orchestrator` | 4 | Многошаговое планирование (δ-1). |
| `role-map` | 1-2 | Карта ролей. |
| `dashboard` | 1 | `dashboard-summary` для COO. |
| `specialist-3-8` | 3 | Helpfulness (отдельный модуль). |

---

## 4. По СТАТУСУ ПРОВЕРКИ

### 4.1 ✅ Проверено эмпирически (наши 4 эксперимента + golden = 5 эваль-сессий)

| Группа | Что подтвердили | Решение |
|---|---|---|
| `meeting-analyze-v2` (5 шагов) | 1 объединённый вызов лучше | Заменить на `meeting-report-fast`. См. §1. |
| `chat-v2` (5 шагов) | Раздельные шаги оптимальны | Оставить, переключить модель на DeepSeek-Pro. См. §2. |
| Specialists 3-1..3-9 (8 шт.) | 1 объединённый `submit_all_8_entities` лучше | Объединить. См. §3. |
| `checkin-sentiment` (operations) | Batch 10× лучше single | Перейти на batch. См. §6. |
| `operations-weekly-digest` | Код-агрегат лучше LLM-агрегата (нет галлюцинаций) | Оставить, переключить модель. См. §6. |
| `skill-trait-detect` | DeepSeek-Pro >= gpt-5.4 (96% vs 92%) | Переключить primary на DeepSeek. См. §8. |

**Итого закрыто эмпирикой: ~22 taskType** (одиночки + цепочки внутри проверенных групп).

### 4.2 ⚠ Покрыто архитектурным правилом (без эмпирики, но решение очевидно)

Применимо общее правило §0.3 ТЗ-копилки: для одиночек на малых входах объединение не имеет смысла, переключаем на DeepSeek-Pro для качества или -flash для дешёвых задач — по существующим маршрутам.

Сюда входят:
- Все merge-арбитры (`regulation-dedupe`, `decision-supersede-detect`, `entity-merge-arbiter`, и т.п.) — ~10 шт.
- Cron-агенты (`entity-resolver`, `reframing`, `idea-status-summarize`, ...) — ~13 шт.
- Tracker-агенты (`intake-auto-triage`, `issue-infer-fields`, ...) — 3 шт.
- Recognition, brand-voice — 3 шт.
- Operations cron'ы (digest, probe-formulate) — 5 шт.
- Telegram-агенты — 4 шт.
- Card-* — 2 шт.

**Итого покрыто правилом: ~40 taskType.**

### 4.3 ❌ Реально НЕ проверено, заслуживает golden-набор

Эти агенты **видны конечному пользователю** или сильно влияют на UX. Любой регресс заметен. Стоит сделать golden-набор по аналогии с `skill-trait-detect`.

**Высокий приоритет (видны пользователю):**

| taskType | Где видно | Почему делать golden |
|---|---|---|
| `clone-respond` | Карточка цифрового двойника | Если ошибётся в стиле — пользователь почувствует. Сейчас на DeepSeek-flash без проверки. |
| `concierge-respond` | Главный AI-помощник (плавающий значок) | ЦА не разработчики — у каждой ошибки большая стоимость. |
| `dashboard-summary` | Сводка дашборда COO | Аналогично weekly-digest — критично к галлюцинациям. |
| `meeting-report-fast` | AI-отчёт по встрече | Уже подтверждён эксп.1 как архитектура, но качество промпта на разных типах встреч (sales / 1-on-1 / ретро) не покрыто. |
| Цепочка `chat-v2` | Продакшен AI-чат | Подтверждена как архитектура, но синтетический QA-набор для регрессий не существует. |

**Средний приоритет (внутренние, но важные):**

| taskType | Зачем golden |
|---|---|
| `commitment-extract-status` | Эскалирует обещания → ошибка ведёт к ложным дёрганиям COO. |
| `proactive-message-craft` | Бот пишет первым — некомфортные формулировки бьют по доверию. |
| `telegram-reply-classify` + `telegram-create-task` | Авто-создание задач из Telegram. Ложные срабатывания → шум. |
| `operations-summary` | Когда COO запрашивает резюме на лету. |

**Низкий приоритет (служебные):**

- `block-ingest`, `block-distill`, `block-linker`, `entity-resolver`, `theme-classify`, `reframing`, `entity-graph-builder` — внутренний pipeline, ошибки видны только метрикам.

---

## 5. Что я предложил бы делать дальше

После применения §1-§8 ТЗ-копилки (≈22 taskType закрыты):

1. **`clone-respond` golden** — самый чувствительный к стилю агент, видно пользователю в карточке двойника. По аналогии с `skill-trait-detect`: 20 valid + 5 reject фикстур, инварианты (стиль, no-hallucination, факт-связанность).

2. **`concierge-respond` golden** — главный AI-вход. Если он шумит — продукт теряет на главной точке контакта.

3. **`chat-v2` end-to-end golden** — 20-30 синтетических вопросов с эталонными ответами/блоками, проверять полную цепочку из 5 шагов.

4. Только после этих трёх — углубляться в `commitment-extract-*` и `proactive-message-craft`.

---

## 6. Замечания и риски

- **Точность списка:** ~95 taskType собрано через инвентарь seed-скриптов; возможно есть несколько вызовов, не объявленных в seed (например, в dialog-layer chat-v2 шаги вызываются без явного taskType — это нужно проверить). Для абсолютной точности — попросить отдельный аудит через grep по `LlmRouterService.call({` в коде.
- **Дубликаты seed-скриптов:** `seed-llm-task-routes-default.ts` и `seed-llm-task-routes-knowledge-core.ts` оба определяют `chat-v2`/`summary-v2`/`task-extract-v2`/`chapter-extract-v2` — риск рассогласования при разных правках. Стоит свести в один источник.
- **Цифра «70»** из изначального обсуждения была примерной — реально ближе к 95 уникальных taskType (зависит от того, как считать варианты типа `meeting-report-fast` отдельно от старого `summary-v2`).

---

## 7. Где это всё лежит в коде

- Маршруты (источник правды для taskType): `backend/scripts/seed-llm-task-routes-*.ts` — 37 скриптов на 2026-05-25.
- Промпты: `backend/src/modules/*/prompts/*.prompt.ts`.
- Воркеры/cron'ы: `backend/src/modules/*/workers/`, `backend/src/modules/*/cron/`.
- Маршрутизатор: `backend/src/modules/ai/services/llm-router.service.ts`.
- Существующий живой реестр: [second-brain/01_projects/ai-jobs.md](../../second-brain/01_projects/ai-jobs.md).
- Verified-карта моделей: [second-brain/01_projects/llm-providers-verified.md](../../second-brain/01_projects/llm-providers-verified.md).
