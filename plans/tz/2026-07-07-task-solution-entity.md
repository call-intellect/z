---
type: tz
feature: task-solution-entity
title: "ТЗ — сущность «Решение задачи» (TaskSolution): агент-материализатор + суточная сборка + UI-вкладка"
status: implemented
date: 2026-07-07
owner: владелец (sergrv80@gmail.com)
architecture: plans/architecture/2026-07-07-task-solution-entity.md
decisions_locked: [Q1 отдельная сущность, Q2 двойное назначение, Q3 без слияния + повтор→кандидат в инструкцию, Q4 суточная сборка, Q5 владение всегда, Q6 вкладка]
stand: plans/tz/2026-07-03-regulation-instruction-stand.md (ось A5)
code_anchors:
  - backend/src/modules/tracker/services/issues.service.ts (maybeRaiseMethodCaptureProbe — сигнал закрытия)
  - backend/src/modules/probe/probe-response.handler.ts (maybeApplyMethodCaptureAnswer — ответ опроса)
  - backend/src/modules/knowledge-core/constants/skill-signal-types.ts (reasoning/methodology_step → клон)
  - backend/src/modules/knowledge-core/services/structured-document-compiler.service.ts (переиспользуем сборку тела)
  - backend/src/modules/knowledge-core/workers/operations-daily-digest.cron.ts (образец суточного крона)
  - backend/src/modules/regulations/* + frontend/{src/api,src/domain,app/(authenticated)/regulations} (образец витрины)
---

# ТЗ — сущность «Решение задачи» (TaskSolution)

> Контракт для реализации (скилл `tz-orchestrator`, фаза за фазой). Архитектура (одобрена, решения заперты) —
> [architecture/2026-07-07-task-solution-entity.md](../architecture/2026-07-07-task-solution-entity.md). Строки
> кода дрейфуют — досверяйся по символу.

## 0. Цель, границы, инварианты

**Цель:** материализовать **опыт решения конкретных задач** отдельной сущностью `TaskSolution`
(название · описание · как решалась · исполнитель-владелец · ссылка на задачу), собирать её **суточным сводом**
из сигналов дня (ответ опроса `task.method_capture` + упоминания «как решал» в течение дня), показывать в UI
отдельной вкладкой «Решения задач», не ломая текущее кормление клона.

**Границы:**
- Клон **не трогаем в поведении** — блоки `reasoning`/`methodology_step` по-прежнему кормят SkillProfile (Q2 двойное назначение: добавляем потребителя, не заменяем).
- Дубли решений **не сливаем** как регламенты (Q3). Повтор способа ×N → **кандидат в Инструкцию** (флаг+ссылка), без авто-создания.
- **Ship-On:** фича выкатывается включённой; kill-switch `aiFeatures.taskSolutionEnabled` (ON), реестр флагов.

**Инварианты (целятся стендом A5):**
- сущность создаётся только при содержательном «как решалось» (нет ответа → не плодим);
- владелец = исполнитель (решавший), не упомянувший (ось A4);
- идемпотентность суточной сборки (повторный прогон Δ=0);
- одна задача → одна `TaskSolution` (не дробится на реплики).

## 1. Данные — новая модель `TaskSolution` (Prisma, миграция)

Файл `backend/prisma/schema.prisma` + `bun run prisma:migrate -- --name task_solution`. Модель по образцу
`Regulation`/`Instruction` (версионирование, dataClass, embedding):

```prisma
model TaskSolution {
  id                     String   @id @default(cuid())
  tenantId               String
  title                  String   @db.VarChar(300)          // название задачи
  taskDescription        String   @db.Text                  // описание задачи
  solutionMd             String   @db.Text                  // как решалась (компилятор)
  ownerPersonId          String                             // исполнитель-владелец (обязателен — Q5)
  personSubjectIds       String[] @default([])              // растут клоны (обычно = [owner])
  sourceIssueId          String                             // ссылка на задачу трекера
  sourceBlockIds         String[] @default([])              // блоки-источники (опрос + дневные)
  skillTags              String[] @default([])              // навык/тема — группировка + повтор
  status                 ProcessStatus @default(active)
  version                Int      @default(1)
  currentVersionId       String?
  confidence             Float?
  promotedToInstructionId String?                           // если перерос в инструкцию
  repeatGroupKey         String?                            // ключ группировки похожих решений
  dataClass              DataClass @default(internal)
  dataClassAudit         Json?
  embedding              Unsupported("vector(1536)")?       // title+solution — для повтора/поиска
  lastConfirmedAt        DateTime?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  deletedAt              DateTime?
  deletedById            String?

  org         Org      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  ownerPerson Person   @relation("TaskSolutionOwner", fields: [ownerPersonId], references: [id])
  sourceIssue Issue    @relation("TaskSolutionIssue", fields: [sourceIssueId], references: [id], onDelete: Cascade)

  @@unique([tenantId, sourceIssueId])   // одна задача → одно решение (Q: суточная сборка апдейтит, не плодит)
  @@index([tenantId, status])
  @@index([tenantId, ownerPersonId])
  @@index([tenantId, repeatGroupKey])
  @@map("task_solutions")
}
```
Обратные связи в `Person`/`Issue`/`Org`. pgvector HNSW-индекс для `embedding` — в `postgres-init.sql` (Шаг 5).
`CardVersion.resourceType` — добавить `'task_solution'` в допустимые (история версий как у регламентов).

## 2. Точка входа и сборка (Q4 — суточный свод)

**Сигналы дня → блоки, уже привязанные к задаче** (существующий механизм, не трогаем):
- ответ опроса `task.method_capture` (`maybeApplyMethodCaptureAnswer`) — `signalType∈{reasoning,methodology_step}`, `contextCardId=issue.id`;
- упоминания «как решал» в течение дня (чат/чек-ин/комментарии к задаче) → block-ingest → те же сигналы, привязка к issue через контекст.

**Суточная сборка — новый крон** `task-solution-build.cron.ts` (`@Cron`, час — крутилка, дефолт 03:00 МСК, `timeZone: 'Europe/Moscow'`; образец `operations-daily-digest.cron.ts`):
1. Взять задачи тенанта с новыми `reasoning/methodology_step`-блоками за окно (по `sourceIssueId`/контексту), у которых есть исполнитель.
2. На каждую — собрать `solutionMd` **компилятором** `structured-document-compiler` (новый `OrgDocumentKind`/режим «решение задачи», СОЗДАНИЕ/ДОПОЛНЕНИЕ — старое сохраняется; переиспуем сервис).
3. `upsert` по `@@unique([tenantId, sourceIssueId])` (апдейт, не плодить), `version++`, `CardVersion`.
4. Владелец: `ownerPersonId` = исполнитель задачи (assignee/решавший), `personSubjectIds` — он же (ось A4; упомянувший ≠ владелец).
5. Пусто/нет содержательного «как решалось» → **не создавать** (гейт как у method-capture complexity).
6. Эмбеддинг `title+solution` → `repeatGroupKey` по кластеру похожих (cosine); ≥ порога (крутилка) → пометить `candidateInstruction` (флаг в ответе/уведомление куратору), **без авто-создания инструкции**.

**Клон (Q2):** ничего не меняем — те же блоки продолжают кормить SkillProfile через Специалист 3.7/скилл-путь. `TaskSolution` — дополнительный потребитель тех же блоков.

## 3. Крутилки (AdminSetting, принцип №9)

Реестр `admin-setting-schema-registry.ts` + сид + UI-поле:
- `taskSolution.buildHourMsk` (дефолт 3), `taskSolution.minSignalChars` (порог содержательности), `taskSolution.repeatThreshold` (N похожих → кандидат в инструкцию), `taskSolution.repeatSimilarity` (cosine).
Флаг `aiFeatures.taskSolutionEnabled` (kill-switch, ON) — `typed-config.service.ts` + реестр флагов `docs/operations/feature-flags.md`.

## 4. API (модуль `task-solutions`, образец `regulations`)

`@Controller('api/v1/task-solutions')` + `TenantGuard`, Zod-DTO (`nestjs-zod`) + Swagger:
- `GET /` (список: фильтры owner/skill/status/search, пагинация), `GET /summary`, `GET /:id`, `GET /:id/sources`, `GET /:id/history`, `POST /:id/confirm` (trustTier→human), `DELETE/restore`.
- DTO-цепочка как у регламентов; провенанс (`previewSourceRef`) на источник (задача + блоки).

## 5. Frontend — вкладка «Решения задач» (слои ApiDto→Domain→Ui)

- `src/api/task-solutions.api.ts` (ApiDto + `taskSolutionsApi`), `src/domain/task-solution.ts` (маппер в DomainModel).
- Вкладка: добавить в `app/(authenticated)/regulations/RegulationsListClient.tsx` верхнюю вкладку `TopTab` «Решения задач» **или** отдельную страницу `app/(authenticated)/task-solutions/` со списком+карточкой (макет — архитектура §7). Рекомендация: **отдельная страница-вкладка** рядом (список слева, карточка справа, как регламенты), пункт в навигации памяти.
- Карточка: название/описание/solutionMd/владелец/ссылка на задачу (deep-link в трекер)/история версий; бейдж «🔁 похожих ×N — оформить инструкцию» при `promotedToInstructionId==null && repeatGroup≥порог`.

## 6. Прод-деплой (обновить `docs/operations/prod-deploy-log.md`)

- **Шаг 4:** миграция `task_solution` (новая таблица + enum `CardVersion.resourceType` значение).
- **Шаг 5:** HNSW-индекс `task_solutions.embedding` в `postgres-init.sql`.
- **Шаг 7:** сид крутилок `seed-admin-setting-task-solution.ts` (+ в `apply-prod-deploy.ts STEPS`).
- **Шаг 12:** smoke нового крона `task-solution-build` + Swagger-тег `task-solutions`.
- Флаг `aiFeatures.taskSolutionEnabled` (ON) — Шаг 1 + реестр флагов.

## 7. second-brain / доки

`02_architecture/data-model.md` (+TaskSolution), `module-map.md` (+модуль task-solutions), `01_projects/ai-jobs.md`+`workers-queues.md` (+крон), `01_projects/api-layer.md` (+эндпоинты), `01_projects/frontend-pages.md` (+вкладка), `04_не-сделано/README.md` (строка «повтор→авто-инструкция отложено», если так).

## 8. Фазы

- [x] **Ф1 Данные:** модель + миграция + CardVersion resourceType + postgres-init индекс. typecheck/prisma:generate зелёные.
- [x] **Ф2 Сборка:** `TaskSolutionService` + `task-solution-build.cron` (суточный) + компилятор-режим «решение задачи» + владение + гейт содержательности. Юнит + integration (prefixed).
- [x] **Ф3 Повтор→кандидат:** кластеризация по embedding + `repeatGroupKey` + флаг кандидата в инструкцию (без авто-создания).
- [x] **Ф4 API:** контроллер+DTO+Swagger (образец regulations).
- [x] **Ф5 Frontend:** api/domain/ui-слои + вкладка/страница + карточка + бейдж повтора.
- [x] **Ф6 Крутилки/флаг/деплой:** AdminSetting + kill-switch + сид + STEPS + prod-deploy-log + feature-flags.
- [ ] **Ф7 Стенд:** ось A5 в корпус/эталон (см. стенд-ТЗ) — параллельно, в процессе.

## 9. Acceptance

- [ ] `TaskSolution` материализуется суточной сборкой из сигналов дня (опрос + дневные упоминания), одна задача → одна сущность (идемпотентно);
- [ ] владелец = исполнитель (ось A4); нет содержательного ответа → не плодим; тривиальную гейтим;
- [ ] клон по-прежнему кормится (двойное назначение, поведение не изменилось — снапшоты/тесты клона зелёные);
- [ ] повтор способа ×N → помечен кандидатом в Инструкцию (без авто-создания);
- [ ] API + вкладка «Решения задач» (список+карточка+ссылка на задачу+история) работают;
- [ ] флаг ON (ship-on) + крутилки в AdminSetting; миграция/индекс/сид зарегистрированы в prod-deploy;
- [ ] `typecheck/lint/build` (backend+frontend) зелёные; second-brain обновлён; ось A5 в стенде.

## Итог
Реализовано: Ф1–Ф7 (коммиты 82d01f8a…e39a2c2d). Ф7 (стенд, ось A5) — в процессе, см. [стенд-ТЗ](2026-07-03-regulation-instruction-stand.md).
