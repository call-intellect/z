---
type: tz
status: ready
feature: β-8.2 — Хранитель обещаний (замыкание петли «обещал → сделал?»)
phase: beta-8.2
date: 2026-05-24
parent: plans/tz/2026-05-23-sba-beta-8-personal-relation-coo-checkin.md
related:
  - plans/analysis/2026-05-24-zamykanie-obeschanij.md (источник — все решения утверждены)
  - plans/analysis/2026-05-22-coo-dashboard-and-checkins.md §2.2 пункт 3
  - second-brain/01_projects/probe-agent.md
  - backend/src/modules/probe/probe.service.ts
  - backend/src/modules/knowledge-core/services/router.service.ts (заглушка для `commitment_status`)
---

# SBA β-8.2 — Хранитель обещаний

## 1. Цель и контекст

В коде уже есть тип сигнала `commitment` (обещание, извлечённое из встречи или чек-ина) и `commitment_status` (его закрытие). Маршрутизатор записей знаний `router.service.ts:334` имеет явную заглушку «не обрабатываем до появления специалистов». Этим ТЗ закрываем петлю: появляется специалист, который раз в день ищет висящие обещания и зовёт агента-уточнителя спросить у того, кто обещал, выполнено ли.

Это закрывает функцию контроля операционного директора (функция №6) — «факт против обещания».

Источник всех решений — [исследование 2026-05-24](../analysis/2026-05-24-zamykanie-obeschanij.md), утверждённое владельцем.

## 2. Scope

**Входит:**
- Расширение модели `IdeaBlock` тремя необязательными полями (`commitmentDueDate`, `commitmentStatus`, `commitmentRecipientPersonId`) — заполняются только когда `signalType='commitment'`.
- Новое значение в перечислении типов рёбер графа: `resolves` (запись «изменение статуса» закрывает «обещание»).
- Доработка промпта `block-distill` — для типа `commitment` дополнительно извлекать срок и адресата.
- Новый специалист «Хранитель обещаний» (`Specialist39PromiseKeeperService`).
- Новое расписание `commitment-followup.cron` — раз в день в 09:00 локального времени каждого `Org`.
- Подключение к агенту-уточнителю (`ProbeService`) с новой причиной `commitment.followup`.
- Обработчик ответа на уточнение — создаёт запись `commitment_status`, ставит ребро `resolves`, обновляет поле `commitmentStatus` исходной записи.
- Эскалация: если за 3 дня нет ответа — повторное уточнение операционному директору / владельцу с пометкой «сотрудник X молчит про обещание Y».
- Новый эндпоинт `/api/v1/me/promises` — личный кабинет «Мои обещания».
- Новый виджет «Открытые обещания» на панели `/dashboard/operations`.
- Новая страница `/me/promises`.

**Не входит:**
- Двусторонние обещания (спросить ещё и адресата) — отложено.
- Автоматическое создание задачи в трекере из «обещания со встречи» — отдельный сценарий, не относится.
- Личный показатель «надёжность по обещаниям» (процент выполненных) — отложено.

## 3. Принятые решения

Все семь — из §7 исследования, утверждены владельцем 2026-05-24:

1. **Срок** — пробуем извлечь из текста; не нашли — `commitmentDueDate = createdAt + 5 рабочих дней` (с учётом выходных через существующий `HolidayService`).
2. **Когда спрашиваем** — на следующий рабочий день после `commitmentDueDate`.
3. **Кого спрашиваем** — только того, кто обещал (поле `personId` записи).
4. **Эскалация** — при молчании 3 календарных дня уходит вторичный probe операционному директору и владельцу.
5. **Видимость** — сотрудник видит свои обещания в `/me/promises`. Чужие — не видит.
6. **На панели операционного директора** — с именами, в открытом виде.
7. **Личного показателя «надёжность»** — нет в этой итерации.

Дополнительные технические решения:

8. **Существующие обещания без срока** (то, что уже в базе) — backfill ставит срок `createdAt + 5 рабочих дней`. Это один разовый скрипт.
9. **Идемпотентность вопроса** — `ProbeService` сам защищает от повторов 72 часа (по `contentHash`); специалист дополнительно ставит флаг `commitmentStatus='asked'` после первого вопроса, чтобы не лезть повторно.
10. **`commitmentStatus`** имеет 5 значений: `open` (новое, ещё не спрашивали) → `asked` (вопрос ушёл, ждём ответа) → `fulfilled` / `missed` / `cancelled` (терминальные). Плюс `superseded` если обещание явно заменено другим.

## 4. Зависимости

- α-2 (`done`) — типы сигнала `commitment` и `commitment_status` уже существуют.
- β-5 (`done`) — `ProbeService` готов, новая причина `commitment.followup` регистрируется внутри этого ТЗ.
- β-8 (`done`) — модуль `operations/`, RBAC роль `coo`, панель.
- α-1 (`done`) — каналы доставки для повторного уточнения.
- `tracker` модуль (`done`) — берём оттуда `HolidayService` для расчёта рабочих дней.

## 5. Изменение схемы базы

```prisma
model IdeaBlock {
  // existing
  commitmentDueDate           DateTime?   // дата без времени (00:00 локали Org)
  commitmentStatus            String?     // 'open' | 'asked' | 'fulfilled' | 'missed' | 'cancelled' | 'superseded'
  commitmentRecipientPersonId String?
  commitmentAskedAt           DateTime?   // когда последний раз ушёл probe
  commitmentEscalatedAt       DateTime?   // когда эскалировали при молчании

  commitmentRecipient Person? @relation("CommitmentRecipient", fields: [commitmentRecipientPersonId], references: [id])

  @@index([tenantId, signalType, commitmentStatus, commitmentDueDate])
  @@index([tenantId, personId, signalType, commitmentStatus])
}

model Person {
  // existing
  /// SBA β-8.2 — обратная связь для обещаний, адресованных этому человеку.
  commitmentsToMe IdeaBlock[] @relation("CommitmentRecipient")
}

enum IdeaBlockLinkType {
  // existing значения...
  resolves   // запись 'commitment_status' закрывает 'commitment'
}
```

## 6. Скрипты миграции и backfill

- `backend/scripts/seed-llm-task-routes-beta-8-2.ts` — регистрирует новый тип задачи модели `commitment-extract-dates` (см. §9).
- `backend/scripts/backfill-commitment-due-dates.ts` — разовый скрипт: для всех `IdeaBlock` с `signalType='commitment'` и `commitmentStatus IS NULL` ставит `commitmentStatus='open'` и `commitmentDueDate = createdAt + 5 рабочих дней` через `HolidayService`. Запускается один раз вручную после деплоя.

## 7. REST API

`/api/v1/me/promises` (новый, авторизация — `auth`):
- `GET /?status=open|asked|all&limit=50` — список моих обещаний с пагинацией.
- `POST /:blockId/mark` body=`{status: 'fulfilled' | 'missed' | 'cancelled', note?: string}` — сотрудник вручную закрывает обещание (как ответ на probe, так и проактивно из списка).

`/api/v1/dashboard/operations/open-commitments` (новый, доступ — `coo | owner | admin`):
- `GET /?days=14` — все висящие обещания в команде: кто обещал, кому, когда срок, сколько дней висит, был ли отправлен вопрос, был ли эскалирован.

`/api/v1/personal-relations/commitments` (расширение, доступ — `admin | coo`):
- `GET /?personId=` — обещания человека (исходящие и входящие). Используется в `/persons/[id]`.

## 8. Фоновые обработчики и расписания

**Новое расписание `commitment-followup.cron`:**
- Cron-выражение `0 9 * * *` (каждый день в 09:00) с фильтрацией по `Org.timezone`.
- Шаги для каждого `Org`:
  1. Найти `IdeaBlock` с `signalType='commitment'`, `commitmentStatus='open'`, `commitmentDueDate < now - 1 рабочий день` (через `HolidayService`).
  2. Для каждой — вызвать `ProbeService.suggest({reason: 'commitment.followup', recipientCandidates: [personId.userId], ...})`.
  3. Поставить `commitmentStatus='asked'`, `commitmentAskedAt=now`.
  4. Отдельно — найти `commitmentStatus='asked'`, `commitmentAskedAt < now - 3 дня`, `commitmentEscalatedAt IS NULL` → эскалировать probe ролям `coo` и `owner` с reason `commitment.silence_escalation` + ставить `commitmentEscalatedAt=now`.

**Новый обработчик `commitment-response.handler`:**
- Подписан на событие `notification.responded` от агента-уточнителя.
- Фильтр: `eventType='probe.question'` и в `metaJson.reason='commitment.followup'`.
- Парсит ответ через языковую модель типа задачи `commitment-extract-status` → `{status: 'fulfilled'|'missed', rationale, blockerText?}`.
- Создаёт новый `IdeaBlock` с `signalType='commitment_status'` + `IdeaBlockLink(type='resolves', from=новый.id, to=исходный.id)`.
- Обновляет `commitmentStatus` исходного блока.
- Если статус `missed` и есть `blockerText` — создаёт ещё один `IdeaBlock` с `signalType='blocker'` (отдельный сигнал в общий поток для `Insights Radar`).

**Доработка промпта `block-distill`:**
- Когда модель определяет `signalType='commitment'` — дополнительно возвращает `commitmentDueDateGuess` (если в тексте есть «к пятнице», «до конца месяца» и т.п.) и `commitmentRecipientNameGuess` (если адресован конкретному человеку).
- Парсер сопоставляет имя с `Person` в той же `Org` через нечёткое совпадение; если не сопоставилось — `commitmentRecipientPersonId` остаётся `null`.
- Если срок не извлечён — специалист «Хранитель обещаний» ставит резервный (`createdAt + 5 рабочих дней`) при первой итерации cron'а.

## 9. Новые типы задач языковой модели

```ts
// commitment-extract-dates — извлечь срок и адресата из текста обещания
{ taskType: 'commitment-extract-dates', priority: 'primary',   provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'commitment-extract-dates', priority: 'secondary', provider: 'openai',   model: 'gpt-4o-mini' }
{ taskType: 'commitment-extract-dates', priority: 'tertiary',  provider: 'ollama',   model: 'qwen3.5:9b' }

// commitment-extract-status — разобрать ответ на followup в 'fulfilled' | 'missed' + причина
{ taskType: 'commitment-extract-status', priority: 'primary',   provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'commitment-extract-status', priority: 'secondary', provider: 'openai',   model: 'gpt-4o-mini' }
{ taskType: 'commitment-extract-status', priority: 'tertiary',  provider: 'ollama',   model: 'qwen3.5:9b' }
```

Промпт `probe-formulate` (существующий, β-5) — резервный для случая отказа модели; формирует вопрос вида «Ты обещал X к Y — выполнил?» с кнопками «Да» / «Нет» / «Продлеваю до...».

## 10. Права доступа

В `backend/src/modules/rbac/policies/policy.csv`:

- Новый ресурс `commitment.read` — для роли владельца обещания (через owner-фильтр в сервисе), для `coo`, `owner`, `admin`, `super_admin`.
- Новый ресурс `commitment.write` — только сам владелец (POST /:blockId/mark).
- Расширить блок роли `coo`: `p, coo, *, *, commitment, read`.
- Маршрутизатор `router.service.ts:334` — убрать заглушку `commitment_status: no-op`, заменить на эмит события `commitment.status_received`, на которое подписан `commitment-response.handler`.

## 11. Показатели Prometheus

- `commitments_open_total{tenant_top}` — гейдж: сколько висит.
- `commitments_asked_total{tenant_top}` — счётчик: сколько раз спрашивали.
- `commitments_fulfilled_total{tenant_top}` — счётчик подтверждений «сделано».
- `commitments_missed_total{tenant_top}` — счётчик «не сделано».
- `commitments_escalated_total{tenant_top}` — счётчик эскалаций.
- `commitments_extract_failed_total{tenant_top, reason}` — счётчик: модель не разобрала ответ.

## 12. Интерфейс

- **`frontend/app/(authenticated)/me/promises/page.tsx`** + `MyPromisesClient.tsx` — таблица: текст обещания, кому, срок, статус, цвет. Фильтр «открытые / все». Кнопки «Сделано» / «Не сделано» / «Отменить» / «Продлить до».
- **Виджет «Открытые обещания» на `/dashboard/operations`** — список с группировкой по людям, маркер «давно молчит» (если был `escalatedAt`).
- **На странице человека `/persons/[id]`** — добавляется вкладка «Обещания»: исходящие (что обещал) и входящие (что обещали мне). Видна `coo | owner | admin`, а сам человек видит только свои исходящие.
- В навигации в группе «Я» — новая ссылка «Мои обещания».
- В навигации в группе «Операции» — расширение существующей панели (виджет, не отдельная страница).

## 13. Переменные окружения

- `COMMITMENT_FOLLOWUP_ENABLED: boolean (default true)`.
- `COMMITMENT_FOLLOWUP_LOCAL_HOUR: number (default 9)`.
- `COMMITMENT_FALLBACK_DUE_WORKDAYS: number (default 5)` — резервный срок если не извлечён из текста.
- `COMMITMENT_ESCALATION_DAYS: number (default 3)` — через сколько дней молчания эскалировать.
- `COMMITMENT_MAX_RETRIES: number (default 2)` — сколько раз спрашивать одного человека до эскалации.

## 14. Связь с существующим кодом

- Новый модуль `backend/src/modules/operations/services/specialist-3-9-promise-keeper.service.ts`.
- Новый файл `backend/src/modules/operations/workers/commitment-followup.cron.ts`.
- Новый файл `backend/src/modules/operations/services/commitment-response.handler.ts`.
- Расширить `backend/src/modules/knowledge-core/prompts/block-distill.prompt.ts` — `commitmentDueDateGuess` и `commitmentRecipientNameGuess`.
- Убрать заглушку в `backend/src/modules/knowledge-core/services/router.service.ts:334`.
- Контроллер `backend/src/modules/operations/controllers/my-promises.controller.ts` (новый).
- Контроллер `backend/src/modules/operations/controllers/operations-dashboard.controller.ts` — расширить эндпоинтом `open-commitments`.
- `backend/src/modules/rbac/policies/policy.csv` — новые ресурсы.
- `backend/scripts/backfill-commitment-due-dates.ts` (новый).
- `backend/scripts/seed-llm-task-routes-beta-8-2.ts` (новый).

## 15. Критерии готовности (DoD)

- [ ] 3 новых поля в `IdeaBlock` + новое значение `resolves` в перечислении рёбер графа.
- [ ] Скрипт backfill отработал для существующих обещаний — у всех `commitmentStatus='open'` и валидный `commitmentDueDate`.
- [ ] Промпт `block-distill` извлекает срок и адресата (проверено на 5 фикстурах).
- [ ] Расписание `commitment-followup.cron` находит просроченные обещания, отправляет probe, ставит `commitmentStatus='asked'`.
- [ ] Эскалация через 3 дня работает.
- [ ] Ответ сотрудника через канал → создаётся запись `commitment_status` + ребро `resolves`, исходное обещание получает статус.
- [ ] Эндпоинт `/me/promises` и страница работают.
- [ ] Виджет «Открытые обещания» на панели операционного директора.
- [ ] Сотрудник НЕ видит чужие обещания через `/me/promises` (тест на изоляцию).
- [ ] Маршрутизатор знаний больше не имеет заглушки `commitment_status: no-op`.
- [ ] `typecheck` / `lint` / тесты зелёные.

## 16. Тесты

- **Модульный:** `specialist-3-9-promise-keeper.service.spec.ts` — отбор просроченных + расчёт срока через `HolidayService` + резервный срок.
- **Модульный:** `commitment-followup.cron.spec.ts` — идемпотентность, фильтр по часовому поясу, эскалация после 3 дней.
- **Модульный:** `commitment-response.handler.spec.ts` — разбор ответа, создание `commitment_status`, ребро `resolves`, обновление статуса исходного блока.
- **Модульный:** `my-promises.controller.spec.ts` — изоляция: сотрудник `A` не видит обещания сотрудника `B`.
- **Интеграционный:** полный цикл — обещание со встречи → срок прошёл → cron → probe → ответ → закрытие.

## 17. Риски и страховки

- **Языковая модель неверно извлекает срок** («скоро» → 5 рабочих дней — нормально; «через час» → даст 1 день — приемлемо). Защита: всегда фолбэк 5 рабочих дней; администратор может через будущий эндпоинт поправить вручную.
- **Сотрудник игнорирует probe.** Защита: эскалация через 3 дня операционному директору / владельцу.
- **Спам уточнений.** Защита: `ProbeService` уже даёт `rate_limit` 5/час и 20/день + дедуп 72ч; плюс наш флаг `commitmentStatus='asked'` блокирует повторный заход внутри цикла.
- **Ложное обещание из шумного контекста.** Защита: модель в `block-distill` уже разделяет «обещание» от «обсуждения возможности»; ложные сигналы попадают в общий поток курирования (α-4).
- **Сотрудник снимет с себя сам, не сделав** (`mark fulfilled` без факта). Защита: этой итерации нет — это вопрос доверия. В дальнейшем — связка с задачами трекера для верификации.
- **Эскалация выглядит как ябедничество.** Защита: формулировка probe для эскалации — нейтральная, без оценок; и сотруднику до этого пришёл вопрос два раза — было время ответить.

---

_2026-05-24: готово к старту. Зависит только от β-8 и β-5 (оба done). Делается параллельно с β-8.1 — пересечений нет._
