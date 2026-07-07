---
type: tz
status: ready-to-implement
feature: meeting-tasks-linkage-fix
date: 2026-07-06
owner: svmazur@mail.ru
relates_to:
  - plans/architecture/2026-07-06-meeting-tasks-linkage-fix.md
  - plans/analysis/2026-07-06-meeting-tasks-not-linked.md
---
> Архитектура (одобрена владельцем 2026-07-06): `plans/architecture/2026-07-06-meeting-tasks-linkage-fix.md` · Анализ: `plans/analysis/2026-07-06-meeting-tasks-not-linked.md`

# ТЗ: Задачи встречи возвращаем в карточку встречи + корректный назначенец гостя

**Принцип:** чиним существующий путь извлечения задач встречи (комбо-специалист `SpecialistsCombinedService`), а не строим новый. Задачи, производные от встречи (канал `meeting` **и** `meeting_report`), должны привязываться к встрече и не застревать. Задача, чей названный владелец — не сотрудник (гость), не должна авто-назначаться на постороннего сотрудника.

## Вне scope / отложено владельцем
- Массовый backfill исторических встреч (проставить привязку задним числом) — vNext, отдельным `backfill-*` скриптом при явном запросе владельца.
- Переработка самого алгоритма skill-routing по навыкам — не трогаем; меняем только применимость к meeting-производным задачам.
- Задачи из не-встречных каналов (chatbox/telegram/checkin/api) — поведение не меняем.

## REALITY-CHECK (факт по коду, ветка work/2026-07-02 == origin/dev == прод по этим файлам, сверено SSH 2026-07-06)
- **Комбо реально извлекает задачи встречи в проде** (лог `[PIPE] combo DONE tasks:2`). Путь рабочий — чиним последнюю милю, не переписываем.
- `SpecialistsCombinedService` (`backend/src/modules/knowledge-core/services/specialists-combined.service.ts`) по ingest **отчёта** идёт с `channelKind='chat'`, `sourceType='meeting_report'`, `args.meetingId='report_<id>'` (префиксовано). `persistTasks` (`:256`) зовёт материалайзер с `channel = args.sourceType` (=`meeting_report`), `sourceId = args.meetingId` (=`report_<id>`). Гард `channelKind === 'meeting'` (`:166`, `:413`) — meetingId материалайзеру НЕ передаётся при `chat`/`meeting_report`.
- `TaskDraftMaterializerService` (`backend/src/modules/tracker/services/task-draft-materializer.service.ts`): `meetingId: channel === 'meeting' ? args.sourceId : null` (`:194`); assignee-резолв (`:93-120`) — `orgAssigneeResolver.resolve(hint)`, при null → `skillRouting.suggestAssignee(taskText)` (это и повесило задачу гостя Романа на сотрудницу Айназ).
- `IntakeAutoTriageWorker` (`backend/src/modules/tracker/workers/intake-auto-triage.worker.ts`): `isMeeting = intake.source === 'meeting'` (`~:295`) гейтит always-promote (`meetingPromote`), а также bypass skill-routing (`:303 intake.source !== 'meeting'`) и owner-fallback (`:329`). Промоут: `linkedMeetingIds: intake.meetingId ? [intake.meetingId] : []` (`~:519`) — **проставленного `IntakeIssue.meetingId` достаточно для привязки**.
- `IntakeIssue.meetingId` в схеме УЖЕ есть (`prisma/schema.prisma` model `IntakeIssue`, коммент «source='meeting'»). Для linkage миграция НЕ нужна.
- Спайн `Specialist315TasksService` (`backend/src/modules/knowledge-core/services/specialist-3-15-tasks.service.ts:104-116`) пропускает блоки `meeting`/`meeting_report` с reason `meeting_handled_elsewhere` — «извлекает `meeting-extract-actions`».
- `meeting-extract-actions` — **фантом**: зарегистрирован в роутере (`ai/services/llm-router.service.ts:440,870`) + промпт (`ai/services/prompts/tasks.ts`), но рантайм-вызова НЕТ ни в ветке, ни в `origin/dev` (только комментарии). Спайн делегирует в несуществующее.
- Блок-ingest умеет резолвить голый meetingId из payload отчёта: `block-ingest.worker.ts:1091` `tryGetPayloadMeetingId(payload)` (для `sourceType==='meeting_report'`).
- Поля под «сырое имя владельца» на `IntakeIssue`/`Issue` НЕТ.

## Принятые решения владельца
| # | Решение | Обоснование |
|---|---|---|
| 1 | Владелец извлечения задач встречи = комбо `SpecialistsCombinedService`; `meeting-extract-actions` **сносим** | Комбо уже работает в проде; оживлять фантом = второй экстрактор на том же материале, двойные задачи, лишние токены (доказано в анализе §3, состязательная таблица в разговоре) |
| 2 | Задача с владельцем-гостем (имя не резолвится в сотрудника) → **без исполнителя** + пометка «по словам гостя: <имя>»; skill-routing для неё НЕ применяется (вариант **А**) | Авто-назначение чужой задачи на постороннего создаёт ложную ответственность. Решение владельца 2026-07-06 (архитектура §«Что реши ты») |
| 3 | Задачи встречи (оба канала) идут через always-promote, как `source='meeting'` | Иначе половина застревает `pending` и не видна (анализ §4) |
| 4 | Логи assignee-resolution + meeting-linkage — обязательная часть | Их отсутствие не дало проследить назначение Айназ (анализ §2.7) |

## Доказательство выбора
Полная состязательная таблица (комбо-владелец vs оживить `meeting-extract-actions`) — в анализе §5.2 + §3 и в переписке одобрения. Вывод: вариант 1 (комбо) строго меньше по поверхности и риску, без двойного извлечения. `relates_to` → анализ.

## Термины
«Meeting-производная задача» = задача, извлечённая комбо из блоков встречи, т.е. `channel ∈ {'meeting','meeting_report'}` в материалайзере / `intake.source ∈ {'meeting','meeting_report'}` в авто-триаже. «Голый meetingId» = ULID встречи без префикса `report_`.

---

## Требования (EARS)

- **R1.** Когда комбо материализует задачи по ingest, `channel ∈ {'meeting','meeting_report'}`, система shall проставить `IntakeIssue.meetingId` = голый meetingId встречи.
- **R2.** Если `channel === 'meeting_report'` и `sourceId` имеет вид `report_<ulid>`, then система shall извлечь голый meetingId (предпочтительно из уже резолвнутого payload-значения `tryGetPayloadMeetingId`; fallback — срез префикса `report_`).
- **R3.** Когда `IntakeIssue.meetingId` задан и интейк промоутится в `Issue`, система shall проставить `Issue.linkedMeetingIds = [meetingId]` (существующее поведение `:519` — не регрессировать).
- **R4.** Когда `intake.source === 'meeting_report'`, авто-триаж shall трактовать интейк как meeting-производный: применять always-promote (`meetingTasksAlwaysPromote`), НЕ применять skill-routing и owner-fallback (как для `source==='meeting'`).
- **R5.** Когда материализуется meeting-производная задача и её `hint`-имя владельца НЕ резолвится в сотрудника орга (или имя не названо), система shall оставить `suggestedAssigneeId = null` и НЕ вызывать `skillRouting.suggestAssignee`.
- **R6.** Когда meeting-производная задача осталась без исполнителя, а в извлечении было названо имя владельца, система shall сохранить это имя в `IntakeIssue.ownerHintRaw` и перенести в `Issue.ownerHintRaw` при промоуте; вкладка «Задачи» встречи shall показать «по словам гостя: <имя>».
- **R7.** Система shall НЕ содержать рантайм-регистрации/делегирования в `meeting-extract-actions`; спайн-специалист shall либо сам не встречать этот путь, либо его skip-ветка shall ссылаться на реального владельца (комбо), без делегирования в несуществующий taskType.
- **R8.** Когда резолвится назначенец meeting-производной задачи (материалайзер и авто-триаж), система shall писать структурный лог: `hint`, результат `orgAssigneeResolver` (`resolved`/`not_found`), применялся ли skill-routing, топ-кандидат+confidence (если был), финальный `assigneeId|null`, `reason ∈ {name_hint, skill_routing, guest_unassigned, none}`.
- **R9.** Когда материализуется/промоутится meeting-производная задача, система shall писать структурный лог linkage: `channel`, `sourceId`, резолвнутый `meetingId|null`, `linked: boolean`.

---

## Контракты

### Prisma (аддитивно — новая колонка под «сырое имя владельца»)
```prisma
// model IntakeIssue
ownerHintRaw String? // имя названного владельца, не резолвнутого в сотрудника (гость)
// model Issue
ownerHintRaw String?
```
Миграция: `bun run prisma:migrate -- --name add_owner_hint_raw` (аддитивная, без бэкфилла, без опасных изменений). После — `bun run prisma:generate`. HNSW/GIN не затрагивает.

### Логи (pino, существующий `logs.write` / `logger`)
Assignee-лог (материалайзер + авто-триаж), пример полей:
```json
{ "module": "task-draft-materializer", "action": "assignee_resolve",
  "channel": "meeting_report", "hint": "Роман", "resolverResult": "not_found",
  "skillRoutingApplied": false, "finalAssigneeId": null, "reason": "guest_unassigned" }
```
Linkage-лог:
```json
{ "module": "task-draft-materializer", "action": "meeting_linkage",
  "channel": "meeting_report", "sourceId": "report_01KWV…", "meetingId": "01KWV…", "linked": true }
```
Уровень INFO. Существующий `details`-канал прод-логов (виден в `diag logs`).

---

## Границы фичи
- ✅ **Always:** правки в материалайзере/комбо/авто-триаже/спайне только по meeting-производным задачам; tenant-изоляция сохраняется (все запросы уже с `tenantId`).
- ⚠️ **Ask first:** любое изменение поведения не-встречных каналов; любое изменение алгоритма skill-routing по существу.
- 🚫 **Never:** `process.env.*` мимо `TypedConfigService`; `new PrismaClient()` в скриптах; `prisma migrate` вручную мимо `prisma:migrate`; хардкод порогов (использовать существующие `cfg.taskRouting.*`, `cfg.tracker.*`).

## Граничные контракты
- Не трогаем генерацию отчёта, block-ingest pipeline (кроме передачи готового `tryGetPayloadMeetingId` в комбо, если выбран этот путь резолва — Ф1), FSM встречи.
- `cfg.taskRouting.enabled/autoAssignMinConfidence`, `cfg.tracker.meetingTasksAlwaysPromote/autoAcceptConfidenceThreshold` — существующие AdminSetting-крутилки, значения не меняем.

---

## Фазы

### Ф1 — Привязка задачи к встрече (linkage) `[ ]`
**Ценность:** как руководитель, открываю встречу и вижу её задачи во вкладке «Задачи», а не пустоту.
**Что входит:** резолв голого meetingId для `meeting_report`; проставление `IntakeIssue.meetingId` в материалайзере для meeting-производных каналов; расширение авто-триажа: `meeting_report` получает always-promote.
**Файлы (номера строк — на момент написания, перед правкой перечитать по якорю):**
- `specialists-combined.service.ts` — передать в `persistTasks`/материалайзер голый meetingId для meeting-производных (якорь: `persistTasks(` ~`:256`, гард `channelKind === 'meeting'` `:166/:413`). Предпочтительно прокинуть резолвнутый payload-meetingId из block-ingest (`tryGetPayloadMeetingId`) как отдельное поле `resolvedMeetingId`.
- `task-draft-materializer.service.ts:194` — `meetingId` проставлять для `channel ∈ {'meeting','meeting_report'}`, значение = голый meetingId (из нового аргумента `resolvedMeetingId` ?? срез `report_` префикса из `sourceId`).
- `intake-auto-triage.worker.ts` (`isMeeting` ~`:295`) — `const isMeeting = intake.source === 'meeting' || intake.source === 'meeting_report'`.
**Что НЕ входит:** назначенец (Ф2), логи (Ф4).
**Acceptance:**
- Юнит: материалайзер с `channel='meeting_report'`, `sourceId='report_01KTEST'` → создаёт `IntakeIssue.meetingId === '01KTEST'`.
- Юнит: `channel='meeting'` (транскрипт) → `meetingId === sourceId` (регресс не допущен).
- Юнит авто-триаж: `intake.source='meeting_report'` + `meetingTasksAlwaysPromote=true` → промоут в `Issue`, `linkedMeetingIds=[meetingId]`, не остаётся `pending`.
- `bun run typecheck` (вкл. .spec) · `bun run lint` · `bun run build` зелёные.
**Закрывает:** R1, R2, R3, R4.

### Ф2 — Назначенец гостя, вариант А `[ ]`
**Ценность:** как руководитель, не получаю на сотрудника чужую задачу гостя — она приходит без исполнителя с пометкой «по словам гостя».
**Что входит:** в материалайзере для meeting-производных каналов — не применять skill-routing fallback (оставить `null`, если имя не резолвится); сохранить `ownerHintRaw`; в авто-триаже meeting_report уже не skill-роутит (Ф1 R4); Prisma-колонка `ownerHintRaw` (IntakeIssue+Issue) + перенос при промоуте; отображение «по словам гостя: <имя>» во вкладке «Задачи» встречи.
**Файлы:**
- `prisma/schema.prisma` — `ownerHintRaw String?` в `IntakeIssue` и `Issue` (+ миграция `add_owner_hint_raw`).
- `task-draft-materializer.service.ts:104-120` — обернуть skill-routing блок условием «НЕ meeting-производный канал»; при meeting-производном и `suggestedAssigneeId==null` записать `ownerHintRaw = hint || null`.
- `intake-auto-triage.worker.ts` промоут (`~:505-520`) — перенести `ownerHintRaw: intake.ownerHintRaw` в `Issue`.
- FE вкладка «Задачи» встречи (маппер `ApiDto→DomainModel→UiModel` + компонент; DTO задачи встречи из `MeetingActionItemsService`/issues) — показывать «по словам гостя: <ownerHintRaw>» когда исполнителя нет и `ownerHintRaw` задан. Найти через vexp/grep реальный компонент вкладки.
**Что НЕ входит:** изменение алгоритма skill-routing для не-встречных каналов.
**Acceptance:**
- Юнит: материалайзер `channel='meeting_report'`, hint='Роман' (не сотрудник) → `suggestedAssigneeId=null`, `ownerHintRaw='Роман'`, `skillRouting.suggestAssignee` НЕ вызван (spy).
- Юнит: hint='Сергей' (сотрудник, резолвится) → назначен Сергей, `ownerHintRaw=null`.
- Юнит: не-встречный канал (`chatbox`) — поведение skill-routing НЕ изменилось (регресс-тест).
- FE-снимок/юнит: задача без исполнителя + `ownerHintRaw` → в UI «по словам гостя: Роман».
- typecheck/lint/build (backend+frontend) зелёные; `bunx vitest run` затронутых spec.
**Закрывает:** R5, R6.

### Ф3 — Снос фантома `meeting-extract-actions` `[ ]`
**Ценность:** как компонент извлечения задач, не делегирую в несуществующий путь — единый явный владелец (комбо).
**Что входит:** убрать taskType `meeting-extract-actions` из роутера/промптов ИЛИ (если удаление задевает лишнее) — минимально: привести skip-ветку спайна в соответствие (не ссылаться на несуществующий экстрактор; комментарий/лог-reason → «обрабатывает комбо `SpecialistsCombinedService`»). Проверить, что удаление taskType не роняет типы/тесты.
**Файлы:** `ai/services/llm-router.service.ts:440,870` (регистрация), `ai/services/prompts/tasks.ts` (промпт `buildMeetingExtractActionsPrompt`), `specialist-3-15-tasks.service.ts:104-116` (reason/лог), `ai/services/org-context.service.ts` (тип `MeetingExtractActionsContext` — если завязан). Комментарий в `intake.service.ts:130` — актуализировать.
**Что НЕ входит:** изменение логики спайна для не-встречных блоков.
**Acceptance:**
- `grep -rn "meeting-extract-actions" backend/src --include=*.ts | grep -v spec` → 0 рантайм-регистраций (только, если осознанно, история/док).
- Спайн skip-reason больше не обещает несуществующий экстрактор.
- typecheck/lint/build зелёные; существующие спайн-спеки зелёные.
**Закрывает:** R7.

### Ф4 — Логи assignee-resolution + meeting-linkage `[ ]`
**Ценность:** как инженер/владелец, читаю из `diag logs` почему задача досталась X и почему привязалась/нет — без раскопок кода.
**Что входит:** структурные логи по R8/R9 в материалайзере, авто-триаже, комбо (linkage).
**Файлы:** `task-draft-materializer.service.ts` (assignee-блок + материализация), `intake-auto-triage.worker.ts` (assignee/promote), `specialists-combined.service.ts` (persistTasks linkage).
**Что НЕ входит:** новые метрики prom-client сверх существующих (если нужны — `[N/A: используем существующие incTaskSkillRoutingAssigned/incTaskDraftMaterialized]`).
**Acceptance:**
- Юнит/лог-spy: при guest-задаче эмитится лог с `reason='guest_unassigned'`; при сотруднике — `reason='name_hint'`.
- linkage-лог содержит резолвнутый `meetingId` и `linked=true` для meeting_report.
- Формат совпадает со сниппетами «Контракты/Логи»; читается через `diag logs --module TaskDraftMaterializerService`.
**Закрывает:** R8, R9.

## Граф зависимостей
Ф1 → Ф2 (Ф2 опирается на meeting-производную ветку и колонку; но Prisma-колонку можно завести в начале Ф2). Ф3 и Ф4 независимы, могут идти параллельно после Ф1. Строгий порядок: **Ф1 первой** (несёт ядро linkage и определение «meeting-производный»).

## Сквозные аспекты
- **RBAC/tenant:** `[N/A по новым границам]` — все затронутые запросы уже tenant-scoped; новых эндпоинтов нет (кроме поля в существующем DTO задач встречи).
- **Observability:** покрыто Ф4 (логи); метрики — существующие.
- **Errors/идемпотентность:** материализация идемпотентна по `externalId` (существует, не регрессировать); проставление `meetingId`/`ownerHintRaw` — на том же upsert-пути.
- **Миграции:** Ф2 — аддитивная колонка `ownerHintRaw` (без бэкфилла старых — vNext).
- **Rollout/флаг (Ship-On):** фича выкатывается ВКЛючённой; отдельный флаг НЕ вводим (не «решение владельца», не аварийный рубильник — это фикс поведения). Строку в `feature-flags.md` не добавляем.
- **Тесты:** юнит на материалайзер/авто-триаж/комбо + FE-юнит вкладки; перечислены пофазно.

## Pre-mortem / Риски
- **Двойное извлечение** (транскрипт `meeting` + отчёт `meeting_report` дают одну задачу дважды): проверить дедуп по `externalId`/`sourceBlockId` — при обоих каналах не создать дубль с разным `meetingId`. Если риск реален — в Ф1 acceptance добавить проверку идемпотентности по паре встреча+текст. (Из анализа: на разобранной встрече сработал только `meeting_report`, но убедиться на юните.)
- **`report_` не единственный префикс источника** — резолв делать строго по каналу `meeting_report` + валидировать, что остаток похож на ULID; иначе `meetingId=null` + linkage-лог `linked=false` (не падать).
- **FE-регресс** вкладки задач встречи — снять снимок до/после (playwright, qa-tester) на эталонной встрече `01KWVRAXGM41375A3N54HGSGEQ`.

## Idempotency / prod-deploy
- Prisma-миграция `add_owner_hint_raw` — доезжает авто через `migrate deploy` на `docker compose up -d` (Шаг 4 prod-deploy-log). Обновить `docs/operations/prod-deploy-log.md` Шаг 4 (новая колонка ×2).
- Скриптов seed/patch/backfill нет → `apply-prod-deploy.ts STEPS` не трогаем.

## DoD
- typecheck (вкл. .spec)/lint/build зелёные (backend+frontend); vitest затронутых spec зелёные.
- Все R1–R9 закрыты фазами (трассировка `Закрывает:` совпадает).
- `second-brain/` обновлён: `01_projects/*` по задачам/трекеру (привязка задач встречи), `02_architecture/data-model.md` (новая колонка `ownerHintRaw`); `prod-deploy-log.md` Шаг 4.
- Реестр не-сделанного: строка про этот баг — перенести в «Закрытые (архив)» после выката.
- Рефлексия в `05_история/`.
- Ручная приёмка (qa-tester): встреча `01KWVRAXGM…` → вкладка «Задачи» показывает 2 задачи; задача гостя без исполнителя с «по словам гостя: Роман».

## Итог
_(заполнит tz-orchestrator по завершении: что реализовано целиком, что осталось.)_
