---
type: tz
status: ready-to-implement
feature: tracker-card-redesign-and-progress
date: 2026-06-20
owner: Сергей (владелец Z/Кора)
relates_to:
  - plans/analysis/2026-06-20-tracker-card-anatomy-and-board-ux.md
  - plans/analysis/2026-06-06-tracker-ux-audit-and-simplification.md
  - second-brain/01_projects/tracker.md
---
> Анализ: `plans/analysis/2026-06-20-tracker-card-anatomy-and-board-ux.md` (status: research-complete) · Статус согласования развилок: 2026-06-20 (Р1, Р2, Р3 — владелец «согласен», делаем все три волны одним ТЗ).

# ТЗ: Редизайн карточки трекера + датированный прогресс + паритет (3 волны)

## Принцип
Лицо карточки на доске считывается за <2 сек (что/кто/когда/насколько готово/откуда), богатство — в детали; «датированный прогресс» — отдельная сущность, авто-черновик которой готовит Кора из графа знаний; затем добираем table-stakes-паритет. Делаем тремя волнами в одном ТЗ — чтобы Волна 3 не потерялась.

## Вне scope / отложено владельцем (каждый хвост — судьба)
- **Прогресс в Telegram-помощнике** — отдельным ТЗ, пересекается с [[../analysis/2026-06-11-telegram-agentic-interface]] / assistant-channels. Здесь только кабинет.
- **Критический путь / авто-сдвиг сроков на Ганте** — отдельный vNext-ТЗ; здесь Гант только включаем (Ф4), зависимости уже есть (`IssueRelation`).
- **Навигация/термины/«Принять» во Входящих** — закрыты прошлым аудитом [2026-06-06](../analysis/2026-06-06-tracker-ux-audit-and-simplification.md), не дублируем.
- **Привязка worklog к деньгам/биллингу** (Shtab-стиль) — vNext; здесь только учёт минут (Ф12).

---

## Цель + Зачем
**Болезненное состояние (из анализа §1):** на доске карточка узкая, тёмная, заголовок в одну строку с обрезкой — «не видно, что за задача и что внутри»; при этом богатые возможности (переписка, файлы, чек-листы, история) спрятаны и не обнаруживаются; нет first-class «датированного прогресса»; отсутствуют table-stakes (кастом-поля, автоматизации, повторяющиеся задачи, worklog).
**Метрика «решено»:**
- Волна 1: на лице карточки присутствуют и считываются ≥5 сигналов (приоритет-цвет, прогресс, дедлайн-срочность, исполнитель, провенанс), заголовок не режется на полуслове (2 строки), контраст текста ≥4.5:1.
- Волна 2: у задачи можно вести датированные обновления прогресса; ≥1 авто-черновик из графа доступен к подтверждению, если по задаче были сигналы.
- Волна 3: задача поддерживает кастом-поля, повторение, шаблон, worklog (под флагом проекта); правила-автоматизации применяются к событиям задачи.

Доказательная база (research-цитаты с URL) — в анализе §5–§8: Linear/Trello/Kaiten (фасад), Asana/Linear Project Update (датированный прогресс как сущность), NN/g + Refactoring UI + WCAG (считываемость), EasyStandup/Steady (авто-журнал из активности).

---

## REALITY-CHECK (что уже есть / чего нет — проверено кодом 2026-06-20)

**Уже есть (НЕ переделывать, переиспользовать):**
- Модель `Issue` богатая ([verified] `backend/prisma/schema.prisma:9174`): `priority`, `startDate`/`dueDate`/`completedAt`, `descriptionStripped`, `sourceBlockIds`/`previewQuote`/`previewSourceRef`/`confidence` (провенанс), `checklistTotalCount`/`checklistDoneCount`, `linkedMeetingIds`, `externalSource`.
- Деталь задачи раскрывает всё ([verified] `frontend/app/(authenticated)/issues/[id]/IssueDetailClient.tsx:54-126`): описание, подзадачи, чек-листы, связи, похожие, **файлы** (`IssueAttachment`), AI-чат, **комментарии** (`IssueComment`: треды/голос/@/спасибо), **активность** (`IssueActivity`).
- Домен карточки уже несёт нужные поля ([verified] `frontend/src/domain/tracker/issue.ts:152-197`) — Волна 1 **без бэкенда/миграций**.
- `ActivityRecorderService.record()` ([verified] `backend/src/modules/tracker/services/activity-recorder.service.ts:26`) — точка записи `IssueActivity` (использовать в Волне 2).
- Образец воркера: `GoalAlignmentLowCron` ([verified] `backend/src/modules/tracker/workers/goal-alignment-low.cron.ts`) — `@Cron` + `cfg.getDynamic(flag)` + Redis-dedup `SETNX EX` + per-Org loop + metrics. **Копировать паттерн** для воркера авто-черновика.
- Образец API: `CommentsController` ([verified] `backend/src/modules/tracker/controllers/comments.controller.ts`) — `@Controller('api/v1')`, `CookieAuthGuard`+`TenantGuard`, `ZodValidationPipe`, `RequireSubscription`, RBAC `canRead/canWrite('issue')`, коды ошибок `tenant_required`/`forbidden`. **Копировать для прогресс-апдейтов и Волны 3.**
- Образец кастом-полей: `TableProperty`/`TablePropType` ([verified] `schema.prisma:11217`) — `config Json` + фракционный `order Decimal` + `isPrimary`. **Образец для `IssueFieldDef` (Ф9).**
- Зависимости задач — **есть** `IssueRelation` (blocks/blocked_by/duplicates/relates_to) + UI `IssueRelations`. Гант-вид — **есть** `gantt/page.tsx` + `Project.gantViewEnabled` (default false). Загрузка команды — **есть** `workload/`. (Red-team в анализе ошибочно счёл их отсутствующими — исправлено.)

**Чего НЕТ (проверено отсутствием модели в `schema.prisma`):** сущности «обновление прогресса», `IssueFieldDef/Value` (кастом-поля задачи), `IssueAutomationRule`, `IssueRecurrence`/`IssueTemplate`, `IssueWorklog` (флаг `timeTrackingEnabled` есть, модели нет).

**Прод-лаг:** деталь карточки чинилась в ветке (аудит 2026-06-06 §3.1) — перед Волной 1 убедиться, что `/issues/[id]` открывается (иначе бейджи «есть обсуждение» ведут в тупик).

---

## Принятые решения владельца (2026-06-20 — не пересматривать)

| # | Решение | Обоснование (почему) |
|---|---|---|
| Р1 | Карточка **компактная по умолчанию** + 3 сканируемых сигнала (приоритет-цвет с дублем иконка/текст, прогресс-бар, чип «из встречи/из решения»), 2-строчный заголовок, починка контраста. «Широкий вид» — переключатель, не дефолт. Тепло/палитру взять из прототипа `frontend/public/demo/index.html`. | Анализ §10: широкая-дефолт регрессит скан большого бэклога и мобильный (NN/g, IxDF); жалоба самого Kaiten на «тесноту» = лечить считываемость, не ширину. WCAG 1.4.1: цвет всегда с дублем. |
| Р2 | Датированный прогресс — **отдельная сущность** (дата + health 3 цвета + текст + опц. «сделано/дальше»), **авто-черновик из графа**, человек подтверждает (не авто-постинг). | Анализ §7: комментарии тонут; Asana/Linear вынесли в first-class; ручной ввод = busywork/слежка (Jira-worklog); авто-сбор из графа — обгон, ядро Коры. |
| Р3 | Три волны в одном ТЗ, порядок Волна1→Волна2→Волна3. | Анализ §11: Волна 1 дёшево чинит жалобу; Волна 2 даёт обгон; Волна 3 — догон-пол. |
| Р4 | Гант: включить `gantViewEnabled` по умолчанию (default true + backfill существующих), как `cycleViewEnabled`/`intakeViewEnabled`. | Ship-On (CLAUDE.md п.8): «спящий OFF» запрещён; Гант — table-stakes (Яндекс Трекер/Asana/Bitrix). |

**Доказательство выбора** — состязательные таблицы и матрица вариантов в анализе §9–§11 (не дублируем; оркестратор читает анализ).

---

## Scope: Входит / Не входит (на уровне ТЗ)
**Входит:** Ф1–Ф12 ниже (Волна 1 фронт; Волна 2 сущность+воркер+UI; Волна 3 кастом-поля/автоматизации/повторение+шаблоны/worklog).
**Не входит:** см. «Вне scope» выше + любые правки навигации/терминов/Входящих.

## Граничные контракты с другими ТЗ
- Провенанс-резолв — через существующий `ProvenanceService`/`ProvenanceChip` (не реализовывать заново; `sourceBlockIds`→deepLink уже есть).
- Граф знаний (IdeaBlock, матч блок↔задача) — переиспользовать механику `TaskClosureCandidate` ([verified] `schema.prisma:9327`, матч `sourceBlockId`↔`issueId` + cosine), НЕ строить новый матчер.
- LLM — только через `LlmRouterService` (taskType), не прямые вызовы провайдера.

## Инварианты Z (ссылки, не дублируем — проверить соблюдение)
Стек Bun+Node+TS; **миграции версионируемые** `bun run prisma:migrate -- --name <...>` (CLAUDE.md, skill `prisma-db-push-rules` — НЕ `db push`); `prisma:generate` после правок; скрипты — `createPrismaClient()` из `scripts/_lib/prisma.ts`, импорты `../src`; новые seed/patch/migrate → `apply-prod-deploy.ts` `STEPS` + `prod-deploy-log.md`; ENV только через `TypedConfigService`; **крутилки (пороги/кадэнс/округление) → AdminSetting** через `getDynamic`+registry+seed+UI, не ENV/хардкод; multi-tenancy `@@index([tenantId,…])`+`TenantGuard`; LLM primary DeepSeek/OpenAI-proxy, embeddings `text-embedding-3-small`, раздел «prompt caching» обязателен; флаги — Ship-On (только kill-switch или решение-владельца); **UI только русский**, парные токены `bg-{color}`+`text-{color}-fg`; **без нарративных комментариев в TS** (Prisma `///`-доки контракта разрешены — как в текущей схеме).

---

# ВОЛНА 1 — Лицо карточки (фронт, без миграций кроме Р4)

## Фаза 1 — Редизайн `IssueCard.tsx` (3 сигнала + 2 строки + провенанс + контраст)
**Цель:** карточка считывается за <2 сек; добавить недостающие сигналы из уже имеющихся полей домена.
**Картография:** `frontend/src/ui/tracker/IssueCard.tsx` (текущий рендер :31-92), `IssuePriorityIcon.tsx`, `frontend/src/domain/tracker/{issue.ts,enums.ts}`, палитра-референс `frontend/public/demo/index.html` (секция «Доска задач», классы `chip info/warn/risk`, `progress`, `led`), токены `frontend/tailwind.config.ts`.
**Что входит (R1–R5):**
- **R1.** Заголовок — **2 строки** (`line-clamp-2`, line-height ~1.35), без жёсткого `truncate` одной строкой.
- **R2.** **Чип приоритета** цветом с дублем «иконка + текст» (`ISSUE_PRIORITY_LABELS`): urgent→danger, high→warning, medium→нейтральный, low/none→приглушённый. Парные токены `bg-*`+`text-*-fg`, контраст индикатора ≥3:1 (WCAG 1.4.11), текст ≥4.5:1. Не `text-white` на цветном.
- **R3.** **Прогресс-бар** (визуальный, не только «3/7»): доля = `checklistDoneCount/checklistTotalCount`, если чек-листов нет — скрыт. Цвет: норма→accent, при просрочке задачи→warning.
- **R4.** **Чип «из встречи / из решения»**: если `sourceBlockIds.length>0` или `externalSource∈{meeting,...}` — показать чип источника (встреча/решение/письмо/чат/помощник по `externalSource`+маппинг). Это дифференциатор Коры — на лице обязателен.
- **R5.** **Дедлайн-чип с цветом срочности** (использовать `dueDateLabel`, `isOverdue`→danger, «сегодня/завтра»→warning); рядом **дата начала** `startDate` если задана («с 18 июня»); бейджи-намёки «есть обсуждение/файлы» НЕ в этой фазе (нет счётчиков в домене карточки — см. Что НЕ входит).
- Группировка whitespace: суть-блок (приоритет+заголовок) визуально отделён от мета-блока (исполнитель/дедлайн/прогресс/источник) — Refactoring UI.
**Что НЕ входит:** счётчики комментариев/вложений на лице (нет полей `commentCount`/`attachmentCount` в `IssueApi` — добавление = отдельная мини-задача бэкенда, вынести в Ф8/vNext); «широкий вид» (Ф3); изменения API.
**Acceptance:**
- `grep -E "line-clamp-2|sourceBlockIds|externalSource" frontend/src/ui/tracker/IssueCard.tsx` → совпадения есть.
- Нет `truncate` на заголовке (есть `line-clamp-2`); нет `text-white`.
- `cd frontend && bun run typecheck && bun run lint` — зелёные.
- Визуально (Playwright, `qa-tester`): на доске у задачи с чек-листом виден прогресс-бар; у задачи из встречи — чип «из встречи»; длинный заголовок переносится на 2 строки, не режется.
**Closes:** R1, R2, R3, R4, R5.

## Фаза 2 — Фикс `IssueSidebar.tsx` (даты + резолв названий)
**Цель:** убрать сырой cuid, показать недостающие даты.
**Картография:** `frontend/src/ui/tracker/IssueSidebar.tsx:63-89` (сейчас `Срок`/`Создана`; `Спринт`={cycleId}, `Цель`={goalId} сырьём), хуки `frontend/src/hooks/tracker/useCycles`/`useGoals` (если есть; иначе include в `IssueApi`).
**Что входит (R6–R7):**
- **R6.** Добавить строки **«Срок начала»** (`startDate`) и **«Выполнена»** (`completedAt`) — формат `ru-RU`, «—» если пусто.
- **R7.** «Спринт» и «Цель» — резолвить в **название** (`Cycle.name`/`Goal.title`), не cuid. Если хук недоступен — добрать названия через include в ответе `GET /issues/:id` `[ASSUMPTION: проще обогатить ответ issue полями cycleName/goalName, чем тянуть отдельные запросы — оркестратор выбирает по факту наличия хуков]`.
**Что НЕ входит:** редактирование дат из sidebar (есть отдельные контролы); смена спринта/цели.
**Acceptance:** в sidebar нет отображения «голого» cuid для спринта/цели; видны «Срок начала»/«Выполнена»; `typecheck`/`lint` зелёные; Playwright: открыть задачу со спринтом → видно название спринта.
**Closes:** R6, R7.

## Фаза 3 — Переключатель плотности «Компактно / Широко»
**Цель:** дать «широкий вид» опцией, дефолт — компактный (Р1).
**Картография:** board-клиенты `frontend/app/(authenticated)/projects/[slug]/board/BoardClient.tsx` и `.../boards/[boardId]/board/BoardClient.tsx`, `frontend/app/(authenticated)/projects/TasksWorkspaceClient.tsx` (агрегированная доска «Задачи»), `IssueCard` проп `compact`.
**Что входит (R8):**
- **R8.** Тумблер «Компактно/Широко» в шапке доски; состояние персистится (localStorage ключ `tracker.cardDensity`, дефолт `compact`). «Широко» = расширенный режим `IssueCard` (превью `descriptionStripped` 1–2 строки, крупнее аватар/чипы); «Компактно» = Ф1-режим. Дефолт компактный.
**Что НЕ входит:** per-проектное хранение в БД (localStorage достаточно для MVP — `[ASSUMPTION]`); разные плотности на разных досках одновременно.
**Acceptance:** дефолт-рендер = компактный; переключение меняет вид и сохраняется после reload; `typecheck`/`lint` зелёные.
**Closes:** R8.

## Фаза 4 — Гант по умолчанию (Ship-On)
**Цель:** убрать «спящий OFF» (`gantViewEnabled` default false).
**Картография:** `Project.gantViewEnabled` (`schema.prisma:8865`), место чтения флага во вкладках проекта (`ProjectViewShell.tsx`/nav), backfill-паттерн `backend/scripts/backfill-*.ts`.
**Что входит (R9):**
- **R9.** Сменить default `gantViewEnabled` → `true` (миграция); backfill `gantViewEnabled=true` существующим проектам, у кого `false` и не выставлен явно владельцем `[ASSUMPTION: явного «владелец выключил» не отслеживаем — считаем все false дефолтными, ставим true; если позже нужна память выбора — отдельная колонка]`. Убедиться, что вкладка Гант рендерится при флаге true.
**Что НЕ входит:** критический путь/авто-сдвиг (vNext); удаление флага (оставляем как per-проектный view-тумблер, как `cycleViewEnabled`).
**Acceptance:**
- Миграция в `prisma/migrations/*` меняет default на true; `backfill-gant-view.ts` идемпотентен (повторный прогон = no-op), зарегистрирован в `apply-prod-deploy.ts` `STEPS` (phase backfill, skipBootstrap) и в `prod-deploy-log.md` Шаг 8.
- Новый проект создаётся с Гант-вкладкой видимой; `bun run prisma:generate` + `typecheck` зелёные.
**Closes:** R9.

---

# ВОЛНА 2 — Датированный прогресс (сущность + авто-черновик из графа)

## Фаза 5 — Prisma-модель `IssueProgressUpdate` + миграция
**Цель:** first-class «обновление прогресса».
**Контракт (дословный сниппет, добавить в `schema.prisma` рядом с `IssueComment`):**
```prisma
/// Датированное обновление прогресса задачи (Asana/Linear Project Update-стиль).
/// health — строкой (расширяемо, не enum). authorType=ai_agent + draftState=pending —
/// авто-черновик из графа, ждёт подтверждения человеком (НЕ авто-постинг).
model IssueProgressUpdate {
  id             String    @id @default(cuid())
  tenantId       String
  issueId        String
  authorId       String?   /// null пока авто-черновик не подтверждён
  authorType     String    @default("human") /// human | ai_agent
  health         String    /// on_track | at_risk | off_track (в норме/риск/буксует)
  body           String    @db.Text
  doneText       String?   @db.Text /// «что сделано»
  nextText       String?   @db.Text /// «что дальше»
  draftState     String?   /// null=опубликовано | pending | accepted | edited | rejected (для ai_agent)
  sourceBlockIds String[]  @default([]) /// провенанс: блоки графа авто-черновика
  evidenceQuote  String?   @db.Text
  confidence     Decimal?  @db.Decimal(4, 3)
  periodStart    DateTime?
  periodEnd      DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  deletedAt      DateTime?

  issue Issue @relation(fields: [issueId], references: [id], onDelete: Cascade)

  @@index([tenantId, issueId, createdAt])
  @@index([issueId, createdAt])
  @@index([tenantId, draftState])
}
```
+ в `model Issue` добавить `progressUpdates IssueProgressUpdate[]`.
**Acceptance:** `bun run prisma:migrate -- --name issue_progress_update` создаёт файл миграции; `prisma:generate` ок; `grep "model IssueProgressUpdate" schema.prisma` есть; миграция зарегистрирована (migrate deploy авто на проде). `prod-deploy-log.md` Шаг 4 обновлён.
**Что НЕ входит:** API/UI (Ф6/Ф8).
**Closes:** R10.

## Фаза 6 — Backend: сервис + контроллер + DTO (по образцу comments)
**Цель:** CRUD обновлений прогресса + запись в `IssueActivity`.
**Картография:** копия паттерна `CommentsController`/`CommentsService` (RBAC `canRead/canWrite('issue')`, `ZodValidationPipe`, `RequireSubscription`, коды `tenant_required`/`forbidden`), `ActivityRecorderService.record()`.
**Что входит (R11–R12):**
- **R11.** Эндпоинты: `GET /api/v1/issues/:id/progress-updates`, `POST /api/v1/issues/:id/progress-updates` (создать вручную), `PATCH /api/v1/progress-updates/:id` (автор/редактирование черновика), `POST /api/v1/progress-updates/:id/confirm` (для draft: pending→accepted|edited, проставить authorId/authorType), `DELETE /api/v1/progress-updates/:id`. Zod-DTO: `health∈{on_track,at_risk,off_track}`, `body` (1..2000), `doneText?`/`nextText?`. Swagger-теги `tracker / progress`.
- **R12.** При публикации/подтверждении — `ActivityRecorderService.record({verb:'progress_updated', actorType, metadata:{health}})`.
**Что НЕ входит:** воркер авто-черновика (Ф7); UI (Ф8).
**Acceptance:** Swagger `/api/docs` показывает 5 эндпоинтов; негативные: чужой tenant→`tenant_required`/403; невалидный `health`→400; `bunx vitest run` на новый spec сервиса зелёный; `bun run typecheck` (вкл. `.spec`) + `build` зелёные.
**Closes:** R11, R12.

## Фаза 7 — Воркер авто-черновика из графа + LLM taskType
**Цель:** Кора сама готовит черновик прогресса из сигналов, человек подтверждает.
**Картография:** образец `GoalAlignmentLowCron` (Cron+getDynamic+Redis-dedup+per-Org), матч блок↔задача — механика `TaskClosureCandidate`, `LlmRouterService` (taskType), prompt registry (`z-ai-agent-rules`), `ALL_LLM_TASK_TYPES`.
**Что входит (R13–R15):**
- **R13.** Воркер/cron `progress-auto-draft`: для активных задач (status=started) собрать **дельту-сигналы** с последнего обновления: закрытые `IssueChecklistItem` (по `completedAt`), смены статуса (`IssueActivity verb=status_changed`), упоминания задачи в графе (`sourceBlockIds`/блоки, ссылающиеся на issue — как `TaskClosureCandidate`). Если сигналов ≥ порога — создать `IssueProgressUpdate(authorType='ai_agent', draftState='pending')` с `sourceBlockIds`+`evidenceQuote`+`confidence`. Идемпотентность: Redis-dedup ключ `progress_auto_draft:<issueId>:<dayKey>` + не плодить второй pending на ту же задачу.
- **R14.** LLM taskType **`issue-progress-draft`**: SYSTEM стабильный (инструкция «сформулируй health+краткий прогресс из сигналов, человеческим языком, без воды»), переменные данные (задача + дельта-сигналы) — в конце user (**prompt caching**: см. раздел ниже). Провайдер — DeepSeek/OpenAI-proxy. Зарегистрировать в `ALL_LLM_TASK_TYPES` + admin-registry + seed + промпт-файл.
- **R15.** Крутилки → **AdminSetting** (getDynamic): `tracker.progressAutoDraftEnabled` (kill-switch, дефолт ON — Ship-On), `tracker.progressAutoDraftMinSignals` (порог, дефолт 2), кадэнс cron. Ни одной в ENV/хардкоде.
**Совместимость с prompt caching:** SYSTEM не содержит данных задачи; меняется только хвост user (issue title/desc + список сигналов). Кэш DeepSeek/proxy сохраняется между задачами.
**Что НЕ входит:** авто-постинг без подтверждения (запрещено Р2); обучение/A-B качества черновика (vNext).
**Acceptance:** прогон воркера на сид-данных с закрытыми чек-пунктами создаёт `IssueProgressUpdate draftState=pending` с непустыми `sourceBlockIds`; повторный прогон в тот же день — no-op (dedup); `issue-progress-draft` присутствует в `ALL_LLM_TASK_TYPES` (grep); kill-switch OFF → воркер пропускает (лог); spec воркера зелёный. Регистрация в `prod-deploy-log.md` Шаг 12 (smoke) + `feature-flags.md` (kill-switch).
**Closes:** R13, R14, R15.

## Фаза 8 — Frontend: прогресс на лице карточки + лента в детали
**Цель:** показать прогресс-обновления и дать подтверждать черновик.
**Картография:** `IssueDetailClient.tsx` (добавить секцию), `frontend/src/domain/tracker/`, `frontend/src/api/tracker/`, `frontend/src/hooks/tracker/`, `IssueCard.tsx` (бейдж).
**Что входит (R16–R17):**
- **R16.** Деталь: секция **«Прогресс»** — лента обновлений по датам (health-цвет «в норме/риск/буксует», текст, «сделано/дальше»), форма создания, и карточка **черновика Коры** с кнопками «Подтвердить / Поправить / Отклонить» (draftState). Подача — «Кора собрала черновик прогресса», тон «помощь», не «отчёт начальству».
- **R17.** Лицо карточки: маленький **health-индикатор последнего обновления** (точка/полоска цветом) — если обновления есть. (Опц. бейдж «есть черновик Коры» владельцу задачи.)
**Что НЕ входит:** прогресс в Telegram (вне scope); графики/метрики (текст+health достаточно для MVP).
**Acceptance:** в детали видна лента + форма; черновик подтверждается (pending→accepted), после чего исчезает из «ждёт подтверждения»; на лице карточки с обновлением виден health-цвет; `typecheck`/`lint` зелёные; Playwright-приёмка.
**Closes:** R16, R17.

---

# ВОЛНА 3 — Table-stakes-паритет

> Волна 3 — крупная; каждая фаза самодостаточна. Если объём фазы превысит одну сессию суб-агента, оркестратор вправе разбить фазу на под-фазы (модель → API → UI), сохранив контракты ниже.

## Фаза 9 — Кастомные поля задачи
**Цель:** произвольные поля на задаче (паритет Jira/Kaiten/Bitrix).
**Контракт (по образцу `TableProperty`):**
```prisma
/// Определение кастом-поля задач (per-project или глобально по Org).
model IssueFieldDef {
  id         String    @id @default(cuid())
  tenantId   String
  projectId  String?   /// null = поле на всю Org
  name       String    @db.VarChar(100)
  type       String    /// text|number|date|checkbox|status|selectSingle|selectMulti|person|url (подмн. TablePropType)
  config     Json      /// { options:[{id,name,color}] } и т.п.
  order      Decimal   @db.Decimal(20, 10)
  archivedAt DateTime?
  createdAt  DateTime  @default(now())
  @@index([tenantId, projectId, order])
}
/// Значение кастом-поля для конкретной задачи.
model IssueFieldValue {
  id       String @id @default(cuid())
  tenantId String
  issueId  String
  fieldId  String
  value    Json
  issue    Issue  @relation(fields: [issueId], references: [id], onDelete: Cascade)
  @@unique([issueId, fieldId])
  @@index([tenantId, fieldId])
}
```
+ `Issue.fieldValues IssueFieldValue[]`.
**Что входит (R18):** миграция; CRUD дефиниций (admin/настройки проекта) + чтение/запись значений; рендер в sidebar детали; опц. отображение выбранных полей на лице (через настройку, по умолчанию НЕ на лице — плотность). Валидация значения по `type`/`config`.
**Что НЕ входит:** formula/rollup/relation-типы (подмножество, как в скоупе выше); кастом-поля на лице по умолчанию.
**Acceptance:** создать поле type=selectSingle с опциями → задать значение задаче → видно в детали; миграция+generate ок; spec на валидацию значения зелёный; `prod-deploy-log.md` Шаг 4.
**Closes:** R18.

## Фаза 10 — Пользовательские автоматизации (правила)
**Цель:** if-this-then-that по задаче (паритет Jira Automation/Asana Rules).
**Контракт:**
```prisma
/// Пользовательское правило-автоматизация. trigger→conditions→actions как JSON.
model IssueAutomationRule {
  id          String   @id @default(cuid())
  tenantId    String
  projectId   String?  /// null = на всю Org
  name        String
  enabled     Boolean  @default(true)
  trigger     Json     /// { type: 'status_changed'|'assigned'|'created'|'due_approaching'|'label_added', ... }
  conditions  Json     /// [{ field, op, value }]
  actions     Json     /// [{ type:'set_status'|'assign'|'add_label'|'set_priority'|'notify'|'create_subtask', ... }]
  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([tenantId, projectId, enabled])
}
```
**Что входит (R19):** миграция; движок-обработчик, подписанный на события трекера (переиспользовать `TrackerEventsService`/`tracker.gateway` события `issue.created/updated`, см. `second-brain/01_projects/tracker.md`); вычисление conditions; применение actions (в т.ч. запись `IssueActivity actorType='system'`); CRUD правил в настройках проекта; защита от циклов (правило не триггерит само себя — guard по depth/origin). Kill-switch глобальный `tracker.automationsEnabled` (getDynamic, ON). `enabled` правила — решение владельца (создаётся ON).
**Что НЕ входит:** межпроектные/расписанные правила (только событийные в MVP); сложные ветвления/циклы.
**Acceptance:** правило «при status=started → assign владельцу» применяется на смене статуса (создаётся `IssueAssignee` + `IssueActivity system`); рекурсия не возникает (тест: action, совпадающий с триггером, не зацикливается); spec движка зелёный; `feature-flags.md` + `prod-deploy-log.md` Шаг 12.
**Closes:** R19.

## Фаза 11 — Повторяющиеся задачи + шаблоны задач
**Цель:** регулярные задачи и шаблоны (паритет Bitrix24/Asana).
**Контракт:**
```prisma
/// Повторение: материализует новую задачу по расписанию из снимка config.
model IssueRecurrence {
  id              String    @id @default(cuid())
  tenantId        String
  projectId       String
  templateIssueId String?
  rrule           String    /// { freq:'daily'|'weekly'|'monthly', interval, byweekday? } сериализованный
  config          Json      /// снимок: title, description, checklist[], assignees[], labels[], priority, estimate
  nextRunAt       DateTime
  lastRunAt       DateTime?
  enabled         Boolean   @default(true)
  createdById     String
  createdAt       DateTime  @default(now())
  @@index([tenantId, enabled, nextRunAt])
}
/// Шаблон задачи (ручное создание из шаблона).
model IssueTemplate {
  id          String   @id @default(cuid())
  tenantId    String
  projectId   String?
  name        String
  config      Json     /// { title, description, checklist[], labels[], priority, estimate, assigneeRole? }
  createdById String
  createdAt   DateTime @default(now())
  @@index([tenantId, projectId])
}
```
**Что входит (R20):** миграции; cron материализации (`nextRunAt<=now` → создать `Issue` из `config` → сдвинуть `nextRunAt`, идемпотентность по `lastRunAt`-дате); создание задачи из шаблона (кнопка в проекте); CRUD повторений/шаблонов. Кадэнс cron → AdminSetting.
**Что НЕ входит:** сложный RRULE (только daily/weekly/monthly+interval в MVP); перенос вложений в копию.
**Acceptance:** повторение с `nextRunAt` в прошлом материализует ровно одну задачу, повторный прогон в тот же день — no-op; «создать из шаблона» создаёт задачу с чек-листом из `config`; spec cron зелёный; `prod-deploy-log.md` Шаг 12.
**Closes:** R20.

## Фаза 12 — Worklog (учёт времени под флагом проекта)
**Цель:** датированный учёт минут под существующим `Project.timeTrackingEnabled`.
**Контракт:**
```prisma
/// Запись учёта времени по задаче (датированная). Под Project.timeTrackingEnabled.
model IssueWorklog {
  id          String   @id @default(cuid())
  tenantId    String
  issueId     String
  userId      String
  minutes     Int
  description String?  @db.Text
  startedAt   DateTime /// дата работы (датированность)
  createdAt   DateTime @default(now())
  issue       Issue    @relation(fields: [issueId], references: [id], onDelete: Cascade)
  @@index([tenantId, issueId, startedAt])
  @@index([userId, startedAt])
}
```
**Что входит (R21):** миграция; CRUD логов (показывать/разрешать только если `project.timeTrackingEnabled`); сумма по задаче в детали; запись `IssueActivity verb='time_logged'`. Округление/правила → AdminSetting если понадобится.
**Что НЕ входит:** деньги/ставки/payroll (vNext); таймер/Pomodoro (vNext).
**Acceptance:** при `timeTrackingEnabled=false` эндпоинт лога недоступен (403/скрыт в UI); при true — лог пишется, сумма видна; spec зелёный; `prod-deploy-log.md` Шаг 4.
**Closes:** R21.

---

## Граф зависимостей фаз
```
Волна 1:  Ф1 → (Ф2, Ф3 параллельны после Ф1) ;  Ф4 независима (БД)
Волна 2:  Ф5 → Ф6 → Ф7 → Ф8     (строго последовательно: модель→API→воркер→UI)
Волна 3:  Ф9, Ф10, Ф11, Ф12 — независимы между собой (каждая своя модель), но ПОСЛЕ Волны 2
```
Строгий порядок волн: 1 → 2 → 3 (Р3). Внутри Волны 3 фазы можно параллелить.

## Границы автономии суб-агента (локальные)
- ✅ Always: переиспользовать существующие сервисы/паттерны (comments/activity/worker-образцы); русский UI; парные токены; миграции через `prisma:migrate`.
- ⚠️ Ask first: менять контракт существующих эндпоинтов задач; трогать FSM встречи/billing; добавлять `signalType`/новый LLM-провайдер.
- 🚫 Never: `db push` вместо миграции; `new PrismaClient()` в скриптах; `process.env.*` мимо `env.schema.ts`; крутилки в ENV/хардкод; авто-постинг прогресса без подтверждения; «спящий OFF»-флаг.

## Pre-mortem / Риски (+ аспекты для `strict-production-review-gate`)
- **Перегруз лица карточки** (Р1-риск): держать ≤5 сигналов; ревью — не добавлять счётчики на лицо без явного решения.
- **Ложный авто-черновик прогресса** (Ф7): порог сигналов + человек подтверждает; ревью — нет пути авто-публикации.
- **Восприятие «слежка»** (Ф7/Ф12): тон «помощь исполнителю»; worklog только под флагом проекта.
- **Рекурсия автоматизаций** (Ф10): guard по origin/depth — обязательный тест.
- **Миграция Гант-дефолта** (Ф4): backfill идемпотентен; не перетереть явный выбор владельца (assumption задокументирован).
- **Дрейф `path:line`:** номера строк — на 2026-06-20; перед правкой перечитать по якорю-символу.

## DoD (общий)
`typecheck` (вкл. `.spec`)/`lint`/`build` зелёные на обеих сторонах; новые spec проходят; `second-brain/01_projects/tracker.md` + `02_architecture/data-model.md` обновлены по таблице производных заметок; `prod-deploy-log.md` (Шаги 4/8/12) + `feature-flags.md` обновлены для затронутых фаз; новые миграции применяются `migrate deploy`; рефлексия после push.

## Итог
_(заполнит tz-orchestrator по факту реализации: что сделано целиком, что осталось, на каких фазах остановились.)_

---
_ТЗ — контракт под `tz-orchestrator`. Реализацию начинать по явному «начни реализацию / погнали Волну 1». Источник правды о коде — репозиторий; `path:line` верифицировать перед правкой._
