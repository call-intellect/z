---
type: tz
status: ready-to-implement
feature: intake-issue-linked-meeting-ids-fix
date: 2026-06-17
owner: svmazur
relates_to:
  - plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md
  - plans/analysis/2026-06-15-task-dedup-and-conversation-to-tracker-reconcile.md
---

> Баг диагностирован 2026-06-17 через diag.ts на встрече 01KV89P3GMAY2P52W3SVKB0BVM (org «Ооо луа»).

---

## Цель

Задачи, извлечённые из встречи через конвейер `MeetingExtractActionsService` →
`IntakeAutoTriageWorker`, должны отображаться в секции «Задачи» карточки встречи
при включённом флаге `knowledge.meetingTasksToTrackerOnly = true`.

**Болезненное состояние:** 4 задачи из встречи 16.06.2026 — `cmqhhkxpd...`,
`cmqhhkvs3...`, `cmqhhkthk...`, `cmqhhkr8e...` — созданы в трекере, но в UI
«Задач не найдено». Владелец не видит итоги встречи.

---

## REALITY-CHECK

| # | Факт | Источник |
|---|------|----------|
| R1 | `knowledge.meetingTasksToTrackerOnly = true` в проде (AdminSetting) | diag 2026-06-17 |
| R2 | `meeting-report-fast.worker.ts:~541` — при `trackerOnly=true` `writeTasks()` делает early return, `Task`-записи НЕ создаются | Read |
| R3 | `MeetingExtractActionsService` создаёт `IntakeIssue` (`source='meeting'`) без поля `meetingId` | Read meeting-extract-actions.service.ts:339-364 |
| R4 | `intake.service.ts` `createFromMeetingNextStep` создаёт `IntakeIssue` без поля `meetingId` | Read intake.service.ts:342-353 |
| R5 | `intake-auto-triage.worker.ts` `autoAccept()` вызывает `this.issues.create()` без `linkedMeetingIds` | Read intake-auto-triage.worker.ts:538-563 |
| R6 | `issues.service.ts` `create()` не принимает `linkedMeetingIds` в `CreateIssueDto` | Read create-issue.dto.ts |
| R7 | `meeting-action-items.service.ts:207` — FLAG=ON ищет `Issue` по `linkedMeetingIds: { has: meetingId }` → 0 результатов | Read |
| R8 | `makeExternalId` в meeting-extract-actions: `mea_<sha1(meetingId+key).slice(0,24)>` — meetingId из externalId не восстановим | Read meeting-extract-actions.service.ts:416-421 |
| R9 | `intake.service.ts` `externalId = 'meeting:<meetingId>:<textHash>'` — meetingId восстановим через split(':')[1] | Read intake.service.ts:318 |
| R10 | `feature/knowledge-core-master` («Comet») — содержит task-dedup Ф0–Ф1, но `linkedMeetingIds` не исправлен | git branch check 2026-06-17 |
| R11 | `model IntakeIssue` в schema.prisma не имеет поля `meetingId` | Read schema.prisma:9567-9622 |

---

## Принятые решения владельца

| Б# | Решение | Обоснование | Дата |
|----|---------|-------------|------|
| Б1 | **Добавить `meetingId String?` к `IntakeIssue`** (Проход A) — хранить meetingId при создании IntakeIssue, прокидывать в `Issue.linkedMeetingIds` при авто-принятии | Единственный способ надёжно связать Issue со встречей: `mea_`-externalId не содержит meetingId, парсинг строк — хрупко. Одно опциональное поле устраняет весь класс проблемы | 2026-06-17 |
| Б2 | **Добавить `linkedMeetingIds` в `CreateIssueDto`** (internal-only поле, optional) — как `sourceBlockIds` (см. A10) | Единственная точка создания Issue = `IssuesService.create()`. Поле помечается `[INTERNAL]` в комментарии — REST-клиенты его не посылают, но внутренние caller'ы (авто-тридж) могут | 2026-06-17 |
| Б3 | **Частичный backfill** — восстановить только те Issues где `externalId` начинается с `meeting:` (формат `intake.service.ts`). Issues с `mea_`-externalId (из `meeting-extract-actions`) отдельно НЕ backfill'ятся (meetingId в hash'е не хранится) | Не плодить ненадёжные данные; потерянные записи — 2026-06-17 встреча, будет видно после фикса | 2026-06-17 |
| Б4 | **Не вводить новый feature-flag** — фикс транзитивно уже за `knowledge.meetingTasksToTrackerOnly`. Отдельного флага для этого фикса не нужно | Ship-On: готова включиться — выкатываем включённой | 2026-06-17 |

---

## Доказательство выбора (Проход A vs Проход B)

| Критерий | A: `meetingId` в IntakeIssue | B: парсинг `externalId` при авто-триаже |
|----------|------------------------------|----------------------------------------|
| Работает для `mea_` (meeting-extract-actions) | ✓ meetingId хранится напрямую | ✗ hash необратим |
| Работает для `meeting:` (intake.service) | ✓ | ✓ через split(':')[1] |
| Backfill для старых записей | ✓ частичный (meeting: формат) | ✓ только meeting: формат — столь же частичный |
| Хрупкость | низкая (поле) | высокая (форматные контракты строк) |
| Объём изменений | миграция + 2 create + DTO + 1 create-call | только 1 create-call + риск регрессии на формат |
| Решает класс, а не кейс | ✓ | ✗ полузащита |

**Выбор: Проход A** — надёжнее, чище, решает весь класс.

---

## Scope

### Входит
- Добавить `meetingId String?` в `IntakeIssue` (schema.prisma)
- Хранить `meetingId` в обоих местах создания `IntakeIssue`: `meeting-extract-actions.service.ts` и `intake.service.ts`
- Добавить `linkedMeetingIds` в `CreateIssueDto` (internal-поле, optional)
- Передавать `linkedMeetingIds` из `intake-auto-triage.worker.ts` при создании Issue
- Записывать `linkedMeetingIds` в `issues.service.ts` `create()`
- Backfill-скрипт для Issues с `externalId` формата `meeting:<meetingId>:*`
- Регистрация backfill в `apply-prod-deploy.ts`

### Не входит
- Ручной тридж (когда человек сам жмёт «Принять» в `/intake` — IntakeService.accept): [ASSUMPTION: тот же `this.issues.create()` путь, поле подхватится автоматически через DTO] — нет необходимости отдельно трогать
- Восстановление meetingId для старых `mea_`-intake (технически невозможно без доп. хранилища)
- Изменение логики `MeetingActionItemsService` (она уже корректна — ищет по `linkedMeetingIds`)
- `feature/knowledge-core-master` — баг не исправлен в ветке Comet, этот фикс идёт в `main` → смержить в Comet при ребейзе

---

## Требования (EARS)

**R1.** Когда `MeetingExtractActionsService.extract()` создаёт `IntakeIssue`, система **shall** сохранять `meetingId` в поле `IntakeIssue.meetingId`.

**R2.** Когда `IntakeService.createFromMeetingNextStep()` создаёт `IntakeIssue`, система **shall** сохранять `meetingId` в поле `IntakeIssue.meetingId`.

**R3.** Когда `IntakeAutoTriageWorker.autoAccept()` создаёт Issue из IntakeIssue с `source='meeting'` и непустым `intake.meetingId`, система **shall** передавать `linkedMeetingIds: [intake.meetingId]` в `IssuesService.create()`.

**R4.** Когда `IssuesService.create()` получает `dto.linkedMeetingIds` с ненулевым массивом, система **shall** сохранять их в `Issue.linkedMeetingIds`.

**R5.** Когда `MeetingActionItemsService.listForMeeting()` вызывается с `meetingId` при `FLAG=ON`, система **shall** возвращать Issues где `linkedMeetingIds HAS meetingId`.

**R6.** Backfill-скрипт **shall** быть идемпотентным: повторный запуск не дублирует и не затирает уже правильные `linkedMeetingIds`.

---

## Фазы

### Фаза 1 — Schema: поле `meetingId` в `IntakeIssue` `[ ]`

**Цель:** Добавить одно nullable поле в модель, создать миграцию.

**Файлы:**
- `backend/prisma/schema.prisma` — модель `IntakeIssue` (строки 9567–9622; якорь: `model IntakeIssue {`)

**Что делать:**

Добавить поле после `externalId` (строка 9576):
```prisma
  externalId     String?

  // Фикс linkedMeetingIds 2026-06-17 — ID встречи-источника.
  // Заполняется при создании из встречи (source='meeting').
  // При авто-приёме (IntakeAutoTriageWorker) прокидывается в Issue.linkedMeetingIds.
  meetingId      String?
```

Добавить индекс (после имеющихся `@@index`):
```prisma
  @@index([meetingId])
```

После правки схемы выполнить:
```bash
cd backend && bun run prisma:migrate -- --name add-intake-issue-meeting-id
bun run prisma:generate
```

**Что НЕ входит:** никаких изменений в сервисах в этой фазе.

**Acceptance:**
- `git diff HEAD -- prisma/schema.prisma` показывает поле `meetingId String?` и `@@index([meetingId])`
- Файл миграции создан в `prisma/migrations/`
- `bun run prisma:generate` завершился без ошибок
- `bun run typecheck` зелёный

**Закрывает:** R1, R2 (предпосылка)

---

### Фаза 2 — Хранение meetingId в IntakeIssue при создании `[ ]`

**Цель:** Обе точки создания IntakeIssue теперь пишут `meetingId`.

**Файлы (номера строк на момент написания — перед правкой перечитать):**
1. `backend/src/modules/tracker/services/meeting-extract-actions.service.ts`
   — метод `extract()`, блок `prisma.intakeIssue.create` (~строка 339–364; якорь: `const issue = await this.prisma.intakeIssue.create({`)
2. `backend/src/modules/tracker/services/intake.service.ts`
   — метод `createFromMeetingNextStep()`, вызов `this.create()` (~строки 342–353; якорь: `return this.create(`)

**Что делать:**

**Файл 1** — в `meeting-extract-actions.service.ts`, в объект `data` вызова `prisma.intakeIssue.create` добавить:
```ts
          // Фикс linkedMeetingIds 2026-06-17 — хранить для прокидки в Issue.
          meetingId,
```
Переменная `meetingId` уже есть в scope (`const { tenantId, meetingId } = args` в начале `extract()`).

**Файл 2** — в `intake.service.ts`, в `createFromMeetingNextStep`, в объект, который передаётся в `this.create()`:
```ts
        source: 'meeting',
        rawContent: text,
        // ... остальные поля ...
        meetingId,          // ← добавить
```
Переменная `meetingId` уже есть в scope (`createFromMeetingNextStep(meetingId: string, ...)`).

> **[ASSUMPTION]:** метод `this.create()` в `IntakeService` принимает `Prisma.IntakeIssueCreateInput` или похожий тип — нужно проверить и при необходимости добавить `meetingId?` в его input-тип. Если `create()` принимает строгое `IntakeIssueCreateInput`, Prisma 7 уже включил новое поле после `prisma:generate`.

**Что НЕ входит:** изменения в `intake-auto-triage.worker.ts` — следующая фаза.

**Acceptance:**
- Grep `meetingId` в обоих файлах — поле присутствует в блоках `create`
- `bun run typecheck` зелёный
- `bun run build` зелёный

**Закрывает:** R1, R2

---

### Фаза 3 — `CreateIssueDto` + `IssuesService.create()` принимают `linkedMeetingIds` `[ ]`

**Цель:** Внутреннее поле `linkedMeetingIds` проходит через DTO в БД.

**Файлы:**
1. `backend/src/modules/tracker/dto/issues/create-issue.dto.ts`
   — схема `CreateIssueSchema` (строки 10–70; якорь: `export const CreateIssueSchema = z`)
2. `backend/src/modules/tracker/services/issues.service.ts`
   — метод `create()`, блок `tx.issue.create({ data: {...} })` (~строка 167–197; якорь: `const created = await tx.issue.create({`)

**Что делать:**

**Файл 1** — в `CreateIssueSchema` добавить после `sourceBlockIds`:
```ts
    /**
     * Внутреннее поле — caller'ы вида IntakeAutoTriageWorker прокидывают
     * linkedMeetingIds из IntakeIssue.meetingId. Внешний REST не посылает.
     * Аналогично sourceBlockIds (A10, 2026-06-14).
     */
    linkedMeetingIds: z.array(z.string().min(1).max(64)).max(32).optional(),
```

**Файл 2** — в `tx.issue.create({ data: {...} })` добавить (рядом с `sourceBlockIds`):
```ts
          ...(dto.linkedMeetingIds && dto.linkedMeetingIds.length > 0
            ? { linkedMeetingIds: dto.linkedMeetingIds }
            : {}),
```
Паттерн аналогичен `sourceBlockIds` (строка ~190).

**Что НЕ входит:** контроллер трекера — это internal-поле, в REST-эндпоинт не добавлять.

**Acceptance:**
- Grep `linkedMeetingIds` в `create-issue.dto.ts` — присутствует в схеме
- Grep `dto.linkedMeetingIds` в `issues.service.ts` — присутствует в `data` блоке
- `bun run typecheck` зелёный

**Закрывает:** R4

---

### Фаза 4 — `IntakeAutoTriageWorker` передаёт `linkedMeetingIds` при создании Issue `[ ]`

**Цель:** При авто-приёме meeting-intake Issue получает корректный `linkedMeetingIds`.

**Файл:**
- `backend/src/modules/tracker/workers/intake-auto-triage.worker.ts`
  — метод `autoAccept()`, вызов `this.issues.create()` (~строки 538–563; якорь: `const created = await this.issues.create(`)

**Что делать:**

В объект DTO второго аргумента `this.issues.create(args.suggestedProjectId, { ... })` добавить:
```ts
        // Фикс linkedMeetingIds 2026-06-17 — связка Issue со встречей.
        linkedMeetingIds: intake.meetingId ? [intake.meetingId] : [],
```

Место: рядом с `externalSource` и `externalId` (~строки 556–557).

После этого встречные Issue будут отображаться в секции «Задачи» карточки встречи при FLAG=ON.

**Что НЕ входит:** ручной тридж через `IntakeService.accept()` — там тот же `this.issues.create()` путь; если `accept()` передаёт полный DTO, поле `linkedMeetingIds` нужно добавить и там. Проверить при реализации: `grep 'issues.create\|\.create(' backend/src/modules/tracker/services/intake.service.ts`.

**Acceptance:**
- Grep `linkedMeetingIds` в `intake-auto-triage.worker.ts` — присутствует в вызове `this.issues.create()`
- `bun run typecheck` зелёный
- `bunx vitest run backend/src/modules/tracker/services/issues.service.spec.ts` — зелёный

**Закрывает:** R3, R5

---

### Фаза 5 — Backfill существующих Issues `[ ]`

**Цель:** Восстановить `linkedMeetingIds` для Issues, созданных из `intake.service.ts` до фикса.

**Ограничение (R8, R9):** Issues с `externalId LIKE 'mea_%'` (из `meeting-extract-actions.service.ts`) не backfill'ятся — meetingId в hash'е необратим. Issues с `externalId LIKE 'meeting:%'` можно восстановить — парсим `externalId.split(':')[1]`.

**Файл:**
- `backend/scripts/backfill-meeting-linked-ids.ts` — новый скрипт

**Контракт скрипта:**

```ts
import { createPrismaClient } from './_lib/prisma';

// Идемпотентен: обновляет только записи где linkedMeetingIds=[] И externalId начинается с 'meeting:'
async function main() {
  const prisma = createPrismaClient();
  let updated = 0;
  
  const issues = await prisma.issue.findMany({
    where: {
      externalSource: 'meeting',
      linkedMeetingIds: { equals: [] },
    },
    select: { id: true, externalId: true },
  });

  for (const issue of issues) {
    if (!issue.externalId?.startsWith('meeting:')) continue;
    const meetingId = issue.externalId.split(':')[1];
    if (!meetingId) continue;
    await prisma.issue.update({
      where: { id: issue.id },
      data: { linkedMeetingIds: [meetingId] },
    });
    updated++;
  }
  
  console.log(`backfill-meeting-linked-ids: updated ${updated} из ${issues.length} кандидатов`);
}
main();
```

**Регистрация в `apply-prod-deploy.ts`:**
Добавить в массив `STEPS`:
```ts
{
  phase: 'update',
  name: 'backfill-meeting-linked-ids',
  file: 'scripts/backfill-meeting-linked-ids.ts',
  skipBootstrap: true,  // только при апгрейде
  description: 'Восстанавливает linkedMeetingIds для Issue из meeting-intake (meeting: формат)',
},
```

**Acceptance:**
- Скрипт создан, `bun run typecheck` зелёный на нём
- Повторный запуск не меняет данные (idempotency)
- Строка в `apply-prod-deploy.ts` STEPS

**Закрывает:** R6

---

## Граф зависимостей

```
Ф1 (schema) → Ф2 (store meetingId) → Ф4 (autoAccept)
                                    ↘ Ф3 (DTO) → Ф4
Ф5 — независима, но запускается ПОСЛЕ Ф4 на проде
```

Строгий порядок: **Ф1 → Ф2, Ф1 → Ф3, Ф2 + Ф3 → Ф4, Ф4 → Ф5 (прод)**

---

## Pre-mortem / Риски

| Риск | Вероятность | Что делать |
|------|-------------|------------|
| `this.create()` в `IntakeService` не принимает `meetingId` (строгий input тип) | средняя | После Ф1 `prisma:generate` обновит тип; если `create()` принимает `Prisma.IntakeIssueUncheckedCreateInput` — всё ок; если собственный DTO — добавить поле |
| `IntakeService.accept()` (ручной тридж) не передаёт `linkedMeetingIds` | средняя | Grep в Ф4 и добавить аналогично |
| `feature/knowledge-core-master` разойдётся с этим фиксом | низкая | После мержа Comet в main — ребейзить Comet на этот коммит |
| Backfill затронет Issues, у которых уже есть корректный `linkedMeetingIds` | низкая | Guard `linkedMeetingIds: { equals: [] }` в WHERE |

---

## Совместимость с prompt caching

Не релевантно — этот ТЗ не затрагивает LLM-промпты.

---

## Idempotency / prod-deploy шаги

1. Деплой: `docker compose up -d --build backend`
2. Backfill: `docker compose exec backend bun run scripts/backfill-meeting-linked-ids.ts`
   — безопасен в любой момент после деплоя, повторный прогон = no-op

Запись в `docs/operations/prod-deploy-log.md` → Шаг 4 (миграция `add_intake_issue_meeting_id`) + Шаг 8 (backfill).

---

## DoD

- [ ] `bun run typecheck` зелёный (включая `.spec.ts` файлы)
- [ ] `bun run lint` зелёный
- [ ] `bun run build` зелёный
- [ ] `bunx vitest run backend/src/modules/tracker/services/issues.service.spec.ts` зелёный
- [ ] Файл миграции создан в `prisma/migrations/`
- [ ] `apply-prod-deploy.ts` STEPS обновлён (backfill)
- [ ] `docs/operations/prod-deploy-log.md` обновлён (Шаг 4 + Шаг 8)
- [ ] `second-brain/` обновлён (если затронута архитектура knowledge-core)

---

## Итог

_(Заполняется после реализации)_
