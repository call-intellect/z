---
name: project-architecture-router
description: Навигация по архитектуре Z и оценка impact изменений: чтение second-brain, формирование impact list, определение затронутых слоёв (LiveKit / Backend / DB / S3 / AI). Используй этот скилл ПЕРЕД любым изменением, затрагивающим архитектуру, API-контракты, схему БД, очереди, webhooks LiveKit, AI-pipeline, retention или несколько доменов одновременно. Также используй при вопросах "где найти X", "что затронет изменение Y", "как устроен модуль Z".
---

# Z: навигация по архитектуре

## Точки входа в архитектурную документацию

```
second-brain/
├── index.md                              ← общая карта, читай первым
├── 00_system/                            ← правила работы с самой second-brain
│   ├── SECOND_BRAIN_PROTOCOL.md
│   ├── SOURCE_OF_TRUTH.md
│   ├── STRUCTURE_RULES.md
│   ├── LINKING_RULES.md
│   ├── INDEX_RULES.md
│   ├── TASK_WORKFLOW.md
│   ├── UPDATE_AFTER_CODE_CHANGE.md
│   └── BOOTSTRAP_FROM_CODE.md
├── 01_projects/                          ← заметки по каждому модулю/фиче
│   ├── meeting-types.md                  (9 типов встреч)
│   ├── ai-analysis-by-type.md            (шаблоны AI по типу)
│   ├── roles-and-permissions.md          (Host vs Guest)
│   ├── recording.md                      (запись + retention)
│   ├── capacity-and-infra.md             (мощности, метрики)
│   └── crossmark-integration.md          (как Crossmark встраивает Z)
├── 02_architecture/
│   ├── project-overview.md               (что такое Z, MVP, флоу)
│   ├── tech-stack.md                     (стек, поддомены, S3-стратегия)
│   ├── module-map.md                     (карта модулей и потоков)
│   ├── data-model.md                     (Meeting, Participant, Recording, AI Result, FSM)
│   ├── ai-integration.md                 (внутренние API: ASR + LLM)
│   └── code-pitfalls.md                  (LiveKit, Egress, webhooks, ASR-ловушки)
├── 03_bugs/                              ← разборы сложных багов
├── 04_archive/                           ← устаревшее
└── 05_история/                           ← рефлексия по итогам сессий

plans/
├── analysis/                             ← анализ фичи: суть, цель, открытые вопросы
├── tz/                                   ← техническое задание: scope, изменения, DoD
└── archive/                              ← завершённые/отменённые
```

---

## Протокол перед изменением

Для задач, затрагивающих архитектуру или несколько модулей:

### Шаг 1: Определи bounded context

Прочитай `second-brain/index.md` и найди, к какому домену относится задача:

| Домен | Что включает |
|-------|-------------|
| `meetings` | CRUD встреч, FSM, типы встреч, выбор типа при создании |
| `participants` | Участники встречи, имена, attributes (raise hand) |
| `livekit-bridge` | Создание комнат, генерация токенов (host/guest), приём webhooks |
| `auth-guest` | Гостевой токен, `/g/:guest_token`, capability set |
| `auth` | Авторизация хоста, JWT, роли, сессии |
| `recording` | Запуск/остановка Egress, общая запись + аудиодорожки, S3, retention/TTL |
| `ai-pipeline` | ASR (Vox/GigaAM), диаризация, LLM (Claude Sonnet), prompt registry, AI Result |
| `meeting-types` | 9 типов встреч, шаблоны полей результата |
| `billing / plan-limits` | Тарифы, лимиты участников, retention по тарифу |
| `crossmark-integration` | API для встраивания Z в Crossmark (внешний потребитель) |
| `infra` | LiveKit SFU/Egress/TURN, Postgres, Redis, S3, разделение нод |

### Шаг 2: Прочитай domain README

Для найденного домена прочитай соответствующий файл из `second-brain/01_projects/` или `02_architecture/`.

### Шаг 3: Сформируй impact list

Перед началом правок составь список того, что будет затронуто:

```
Impact list для задачи: <название>

Прямые изменения:
- backend/src/meetings/meetings.service.ts
- backend/src/meetings/dto/create-meeting.dto.ts
- backend/prisma/schema.prisma (модель Meeting)

Косвенные зависимости:
- frontend/src/pages/Meeting — использует MeetingResponseDto
- ai-pipeline — слушает meeting.ended, шаблон зависит от type
- recording — TTL зависит от plan
- livekit-bridge — токен с meeting metadata

Затронутые слои:
[x] backend API
[x] frontend UI
[x] DB schema
[ ] BullMQ queue
[ ] LiveKit webhooks
[ ] Egress
[ ] AI prompts
[ ] retention/cron
```

---

## Карта слоёв и их зависимости (Z)

```
HTTP Request (host или guest)
    ↓
Controller (роутинг, validation, guard)
    ↓
Service (бизнес-логика, проверка ownership / guest_token)
    ↓
Prisma (DB) + EventEmitter (события)
    ↓
LiveKit Server SDK (комната, токен) ─→ LiveKit SFU (media)
                                         ↓
                                    LiveKit Egress ─→ S3
                                         ↓
                                       webhook
                                         ↓
                                      Backend (FSM update)
                                         ↓
                                   BullMQ (ai-pipeline)
                                         ↓
                          ASR → diarization → LLM → AI Result → DB
```

Изменение в нижних слоях каскадит вверх. Изменение схемы БД → проверь сервисы, DTO, frontend API layer. Изменение FSM → проверь webhook handler и AI-pipeline trigger.

---

## Когда обновлять архитектурную документацию

Обновляй `second-brain/` после изменения. Полная таблица — в `CLAUDE.md` (триггер 1). Краткая выжимка:

| Что изменилось | Что обновить |
|----------------|-------------|
| Новая колонка/таблица в БД | `02_architecture/data-model.md` |
| Новый модуль/контроллер | `02_architecture/module-map.md` |
| Новый AI-агент / воркер / job | `01_projects/ai-jobs.md`, `01_projects/workers-queues.md` (создать, если нет) |
| Новый webhook от LiveKit | `02_architecture/module-map.md` |
| Новая публичная страница | `01_projects/frontend-pages.md` (создать, если нет) |
| Новый API-эндпоинт | `01_projects/api-layer.md` (создать, если нет) |
| Изменение бизнес-логики | соответствующий `01_projects/<feature>.md` |
| Удаление модуля | Удалить ссылки во всех файлах second-brain |

**Не обновляй second-brain** при: typo, стили, рефакторинг без изменения логики.

---

## Навигация по backend-модулям

Карта всех модулей — в `second-brain/02_architecture/module-map.md`.

Структура каждого модуля (после появления `backend/src/`):
```
backend/src/<module>/
├── <module>.module.ts
├── <module>.controller.ts
├── <module>.service.ts
├── dto/
│   ├── create-<model>.dto.ts
│   ├── update-<model>.dto.ts
│   └── <model>-response.dto.ts
└── <module>.types.ts
```

---

## Навигация по frontend

| Что ищешь | Где смотреть |
|-----------|-------------|
| Страницы кабинета | `second-brain/01_projects/frontend-pages.md` (по мере появления кода) |
| API-интеграции | `second-brain/01_projects/frontend-api-layer.md` (по мере появления кода) |
| Контексты и хуки | `second-brain/01_projects/frontend-contexts-hooks.md` (по мере появления кода) |
| Точки входа Next.js | стандартная структура `app/` или `pages/` (зависит от выбора App Router vs Pages Router) |

Маршруты MVP см. `second-brain/02_architecture/tech-stack.md`:
- `/meetings`, `/meetings/create`, `/meetings/:id`, `/meetings/:id/result`
- `/g/:guest_token` — гостевой вход

---

## Проверка соседних доменов (специфика Z)

После формирования impact list — проверь соседей:

- **meetings** → смотри **livekit-bridge** (токены), **ai-pipeline** (старт после ENDED), **recording** (Egress)
- **ai-pipeline** → смотри **meeting-types** (шаблоны), **recording** (источник аудио), **prompt-registry** (admin-editable)
- **recording** → смотри **billing/plan-limits** (TTL по тарифу), **infra** (S3 endpoint per env)
- **livekit-bridge** → смотри **auth** (host) и **auth-guest** (guest), **webhooks** (FSM)
- **auth-guest** → смотри **livekit-bridge** (capability set гостя), **frontend `/g/:token`** (UX)
- **crossmark-integration** → смотри **API-контракты meetings** (внешний потребитель — нельзя ломать без согласования)
