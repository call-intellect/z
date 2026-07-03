---
type: tz
feature: task-tracking-stand
title: "ТЗ — Стенд качества трекинга задач (создание · подзадачи/дедуп · журнал · автозакрытие) + baseline"
status: ready-to-implement
date: 2026-07-03
owner: владелец (sergrv80@gmail.com)
cartography: plans/analysis/2026-07-03-task-tracking-stand-code-cartography.md
scenarios: docs/testing/task-stand-scenarios.md
methodology: docs/testing/stand-methodology.md
orchestrator_prompt: plans/tz/2026-07-03-task-tracking-stand.orchestrator-prompt.md
templates: [backend/scripts/clone-stand/, backend/scripts/probe-stand/]
---

# ТЗ — Стенд качества трекинга задач + baseline

> **Контракт для реализации** (исполняется скиллом `tz-orchestrator`, фаза за фазой). Замер — НЕ разворот
> поведения: baseline «как есть» ДО любых фиксов. Точные якоря кода —
> [код-картография](../analysis/2026-07-03-task-tracking-stand-code-cartography.md) (строки дрейфуют —
> досверяться по символу). Банк и линейка — [сценарии](../../docs/testing/task-stand-scenarios.md).
> Образцы стенда — `backend/scripts/clone-stand/` (раннер+манифест+судьи) и `backend/scripts/probe-stand/`
> (сценарии method-capture/task-clarify уже там — переиспользовать).

## 0. Цель, границы, инварианты

**Цель:** построить измерительный стенд `task-stand`, который через **реальный конвейер** льёт 85 синтетических
входов (банк) в синтетический тенант, снимает **машинный исход** каждого (создалась/не создалась задача, дубль-
исход, запись журнала, кандидат закрытия, переход статуса), сверяет с **эталоном по построению** (ground truth
в банке), судит смысл панелью LLM и печатает **baseline** — распределение вердиктов по 4 механизмам + статус
инвариантов INV-1..4 + вердикт по гипотезам Т1–Т10.

**Границы (замер, не разворот):**
- Прод-поведение НЕ трогаем. Прод не трогаем ни в каком виде (`assertNotProd` первым вызовом каждого скрипта).
- Единственная разрешённая правка прод-кода — **аддитивная трасса** (см. §7): расширить возвращаемую петлёй
  диагностику (какой извлекатель сработал, какой порог/слой), поведение-нейтрально. Если для трассы нужна правка
  прод-сервиса — только добавление полей в лог/возврат, без изменения логики; иначе трасса снимается read-only
  из БД (предпочтительно).
- Baseline — в **прод-верной конфигурации** (дефолты крутилок §6 картографии). Отдельные прогоны с
  изменёнными крутилками (калибровка Т10, конфиг-off J-10/J-11) — диагностические, помечаются в отчёте.

**Инварианты линейки (сценарии §1.3) — здесь ЗАМЕРЯЮТСЯ, целятся петлёй ПОСЛЕ baseline:**
INV-1 (0 авто-merge, 0 авто-close) · INV-2 (0 кросс-тенант) · INV-3 (0 инъекций) · INV-4 (идемпотентность).
PASS ≥85% на банке (планка — решение владельца до 1-й итерации).

**Прогноз калибровки (сверить с фактом; резкое расхождение → сначала диагноз `ruler-defect`):**
- Т1 подтвердится частично: часть входов чата/встречи НЕ породит задачу (осиротевший извлекатель) ИЛИ
  породит через `SpecialistsCombined` — стенд обязан показать, какой путь жив.
- Т2 подтвердится: A-04/A-05 (обещание себе) уйдёт в Goal, не в Task.
- Т3 подтвердится: B-02/B-06/B-07 дадут неверное число задач.
- INV-1 будет соблюдён (R13 жёсткий) — если нарушится, это находка №1.

## 1. Файлы (контракт)

```
backend/scripts/task-stand/
  stand.ts            раннер-диспетчер: prepare | seed | settle | run | judge | report | report:nollm | all
  seed-task-feed.ts   Ф0+Ф1: тенант/проекты/статусы/исполнители + baseline-задачи (setup сценариев дедупа/закрытия) + манифест
  inject.ts           Ф2: подача 85 входов банка через реальный конвейер (RawEvent/adapter) + прямые вызовы извлекателей (изоляция Т1)
  assert.ts           Ф3: детерминированные ассерты (создалось? кандидат? relation? count? поля) → per-scenario исход
  judge.ts            Ф4: панель majority-of-3 (линзы форма / поля / исход) через directLlmCall
  report.ts           Ф4/Ф5: scorecard по категориям+механизмам + оси + инварианты + Т1–Т10 + конфиг + было→стало
docs/testing/
  task-stand-scenarios.json        банк 85 (транскрипция из .md по схеме §0.2) — ГОТОВИТ агент, потом НЕ трогать
  task-stand-scenarios-fresh.json  свежие ~15 (антиоверфит)
  task-stand-manifest.json         ground truth по построению (setup-задачи, ожидаемые исходы) — генерит seed-task-feed
  task-stand-report.md / .json     baseline-отчёт (+ per-run архив task-stand-runs/<stamp>/)
  task-stand.md                    README стенда (по образцу probe-stand.md / clone-stand.md)
```

**Регистрация:** добавить строку в реестр стендов `docs/testing/stand-methodology.md` §5. **НЕ** добавлять в
`apply-prod-deploy.ts STEPS` и `prod-deploy-log.md` — стенд локальный, не прод (как clone-stand).

## 2. Предусловия окружения (до prepare)

- `docker compose -f docker-compose.dev.yml up -d` (Postgres :55435, Redis :56381).
- **Живой backend с воркерами** (`cd backend && bun run dev`) — ОБЯЗАТЕЛЬНО: конвейер (ingest → specialists →
  materialize → auto-triage; completion-loop; progress-cron) крутится in-process через `WorkersModule`. Без него
  `inject.ts` положит RawEvent, но задачи/кандидаты не появятся, `pollUntil` не сойдётся. Раннеры `run/judge/
  report` сами бутстрапят `NestFactory.createApplicationContext(AppModule)`.
- `.env` на локальную БД (127.0.0.1), реальные LLM-ключи (извлечение/арбитр/верификатор/судьи — живые модели,
  судьи `deepseek-v4-pro`).
- В скриптах — `createPrismaClient()` из `_lib/prisma.ts` (не голый `new PrismaClient()`); `assertNotProd`,
  `pseudoUlid`, `sleep`, `readConfig` — из `_lib/combat-harness.ts`.

## 3. Конфигурация прогона (среда замера — фиксировать в отчёте)

Плейн-ENV (`backend/.env`, локально):
| Ключ | Значение | Зачем |
|---|---|---|
| `STRELA_ORG` | `<orgId>` | тенант стенда (seed печатает `ORG_ID=` → спарсить) |
| `TASK_STAND_ORG_B` | `<orgId2>` | второй тенант для INV-2 (тенант-изоляция J-01/J-02) |
| `AI_CHAT_DAILY_LIMIT_*` | `100000` | baseline не должен упереться в квоту |

Крутилки на baseline — **дефолты §6 картографии** (tenant-scoped на STRELA_ORG, не глобально), фактические
значения — в отчёт. Ключевые: `taskDedup.suggestThreshold`=0.88 (code-fallback, Т5), `taskClosure.matchThreshold`
=0.85, `autoAcceptConfidenceThreshold`=0.75, `meetingTasksAlwaysPromote`=true, `methodCaptureMinComplexity`=0.5,
`progressAutoDraftMinSignals`=2, все kill-switch ON. Для прогонов калибровки/конфиг-off — менять по одной,
отдельным прогоном.

**Чистка ПЕРЕД каждым прогоном** (иначе меряется прошлый): `bull:*` тенанта (jobId-дедуп rebuild/triage),
answer-кэш `dlg:ans:<org>:*`, `probe:dedup/ratelimit:*`, Redis SETNX прогресса `progress:draft:*`,
`task-dedup`-кэши если есть. Логировать fail-open эмбеддера.

## 4. Фаза 0 — prepare (тенант, проекты, статусы, исполнители)

`seed-task-feed.ts prepare`:
1. Тенант: свежая «Стрела» (`seed-synthetic-company` → `week2/3/4`, живой backend) ИЛИ существующая (org
   `cmr1qbvpx0001pwbwxbgmh1jl`). Спарсить `ORG_ID` → `STRELA_ORG`. Второй тенант ORG_B (минимальный: owner +
   1 проект + статусы) для INV-2.
2. Проекты: ≥1 рабочий проект с `identifier` (напр. `OPS`) + проект «Из встреч» + проект «Входящие»
   (`ensureInboxProjectId`). У каждого — `IssueState` со всеми категориями: backlog/unstarted/started/
   **completed**/cancelled (иначе H-02 упадёт на `no_completed_state`; отдельный проект без completed —
   намеренно, под J-12).
3. Исполнители: сотрудники-Person с `userId` и membership (Игорь/Аня/Петя/Катя/Дима/Мария/Оля — имена из
   банка), owner. Резолв assignee по имени работает (`AssigneeResolverService`).
4. Пины крутилок §3 (tenant-scoped AdminSetting).

**Acceptance 0:** `STRELA_ORG`+`TASK_STAND_ORG_B` заданы; проекты со статусами (в т.ч. один без completed);
исполнители с userId; крутилки на дефолтах, значения записаны.

## 5. Фаза 1 — seed baseline-задач (setup сценариев) + манифест

`seed-task-feed.ts seed`:
- Создать **открытые задачи-setup** для категорий D (дедуп) и G/H (журнал/закрытие) — через `IssuesService.create`
  (реальный путь, с `skipDedup:true` чтобы сам сид не триггерил дедуп): напр. «Подготовить смету по проекту X»
  (Иван), «Обновить прайс на сайте», «Отправить КП клиенту Бета», «Проверить макет…», «Настроить аналитику»,
  «Экспорт», задача с чек-листом 3/5 (F-07), закрытая «Подготовить смету X» (D-07). Дать им дозреть (embedding
  через `issue-embed.worker` — ждать `embedding IS NOT NULL`, иначе KNN-дедуп/закрытие не сматчат).
- В ORG_B — «двойник» открытой задачи для J-01/J-02.
- **Манифест `task-stand-manifest.json`:** для каждого setup — id/title/state/assignee/embedding-ready; для
  каждого сценария банка — ожидаемый исход (ground truth), целевой Т*. Манифест = вход судей (сверяются с ним,
  не «из головы»).

**Acceptance 1:** setup-задачи созданы, эмбеддинги готовы (ждать worker), манифест на месте; ORG_B-двойник есть.

## 6. Фаза 2 — inject (подача банка через реальный конвейер) + изоляция Т1

`inject.ts` — для каждого сценария банка по его `channel`:
- **meeting/chat/telegram/email:** подать вход как **RawEvent** через реальный адаптер
  (`ConversationalIngestAdapter.ingestNotificationResponse` / `injectRawEventDirect` из combat-harness, по образцу
  `clone-build-harness`), с атрибуцией автора (`payload.userId`), датой (сутки — единица разговора, Р3). Дать
  конвейеру усвоиться: **ждать `RawEvent.received=0`** и появления IdeaBlock; затем — обработку специалистами
  (задачи) / роутером (закрытие). Для journal/closure-сценариев (G/H) вход должен классифицироваться в
  signalType done_item/task_completed/task_status_changed — если ingest-классификатор нестабилен, **дублировать
  прямой инъекцией IdeaBlock с нужным signalType** (изоляция петли закрытия от классификатора).
- **manual/api:** прямой `IssuesService.create` (F-01..F-05, D-08).
- **concierge:** `MeTasksService.completeTask` / assistant-create-task-tool (C-06, H-08/H-09).
- **decision:** прогнать через `Specialist33DecisionsService` (C-07).
- **ИЗОЛЯЦИЯ Т1 (обязательно):** для 3–4 репрезентативных creation-входов вызвать извлекатели **напрямую и
  раздельно** — `SpecialistsCombinedService.persistTasks` (живой), `Specialist315TasksService.processBlock`
  (легаси), `TaskExtractionService.extractTasks` (легаси) — и зафиксировать, какой из них реально создаёт
  IntakeIssue/Issue, а какой не вызывается в штатном потоке. Это прямой замер Т1.
- Между инъекциями — чистка Redis-гигиены (§3), учёт rate-limit/dedup probe.
- Триаж: для авто-приёма ждать `IntakeAutoTriageWorker`; для route-to-human — фиксировать `IntakeIssue(pending)`.

**Acceptance 2:** все 85 входов поданы; конвейер устоялся (`RawEvent.received=0`); снят сырой результат каждого
(созданные Issue/IntakeIssue/TaskClosureCandidate/IssueProgressUpdate/IssueRelation/ProbeEvent) в трассу
`task-stand-runs/<stamp>/raw.json`; замер Т1 (какой извлекатель жив) зафиксирован.

## 7. Фаза 3 — детерминированные ассерты (`assert.ts`, без LLM)

Для каждого сценария — сверить сырой результат с `expect` манифеста **по машинным признакам** (методология §2.4):
- **Тип исхода** (точный матч кодов): создан `Issue` / `IntakeIssue(pending|accepted)` / `TaskClosureCandidate` /
  `IssueProgressUpdate` / `IssueRelation('duplicates')` / `ProbeEvent(reason)` / **nothing** / `error(code)`.
- **Счётчик** (`count`): сколько задач/кандидатов/записей создано (ловит проафферацию Т3/J-05: ждём ровно N).
- **Поля** (точный для enum/category/status/refusalReason/error-code; нечёткий/судья — для `title`/assignee-
  резолва/health): `assignee`, `dueDate`, `priority`, `state.category`, `parentId`, `checklistTotalCount`,
  `sourceBlockIds>0`, `suggestedDuplicateOfIssueId`, `health`, `draftState`, `completedAt`.
- **Инварианты (детерминированно):** INV-1 (нет Issue с `completedAt` без confirm-шага; нет merge — задачи не
  удаляются/не сливаются) · INV-2 (ни один матч/кандидат не ссылается на чужой tenantId) · INV-4 (повторный
  прогон E-02/E-03/H-14 не растит счётчики).

**Трасса Т1** (аддитивно, read-only из БД): для каждого созданного `IntakeIssue`/`Issue` — `source`,
`sourceBlockIds`, `createdManually`, кто в цепочке создал (по `IssueActivity`/логам). Если нужна правка прод-кода
для трассы — только добавление полей (§0), снапшот-тесты промптов не трогать, юнит на новые поля.

**Acceptance 3:** `report:nollm` печатает per-scenario тип-исход + count + поля + статус инвариантов, без LLM.

## 8. Фаза 4 — судьи (панель majority-of-3) + report

`judge.ts` — 3 независимые линзы (`directLlmCall`, deepseek-v4-pro, JSON-схема через tool-call, retry×3 до
валидной схемы, majority-вердикт), судья видит `input.text` + `expect` из манифеста:
- **Линза F (форма):** верно ли решено «задача / не-задача / idea / decision / обещание»? (для A/B) — против
  датасета `task-decision-examples.ts` (17 пар) и эталона банка.
- **Линза P (поля):** совпал ли `title` по смыслу, верны ли assignee/срок/приоритет? (нечёткий смысл, не строка).
- **Линза O (исход):** верен ли тип исхода против эталона (same→suggest / different→new / done→candidate /
  partial→progress) — судья подтверждает семантику там, где детерминированный ассерт неоднозначен (напр. арбитр
  дедупа вернул `same` — корректно ли по смыслу).

Вердикт на сценарий (детерминированно, сценарии §1.2): INVARIANT_FAIL → WRONG_OUTCOME → PARTIAL → PASS.
Каждый INVARIANT_FAIL и каждый неожиданный WRONG_OUTCOME — **ручной разбор против сырой трассы** (линейка сама
может врать — ruler-defect чинить первым).

`report.ts` — scorecard: распределение вердиктов **по категориям A–J и по механизмам** (create/subtask/dedup/
journal/closure); оси C/D/G/J/X/P (среднее); **статус INV-1..4** (любой FAIL — красный стоп); **таблица Т1–Т10**
(подтверждён / снят / ruler-defect, с доказательством из трассы); конфигурация прогона (§3, фактические крутилки
+ какой извлекатель жив по Т1); «было→стало» (пока baseline). MD+JSON, архив per-run.

**Acceptance 4:** судьи majority-of-3 работают; report печатает scorecard + оси + инварианты + Т1–Т10 с
атрибуцией; каждый провал сверяем с сырой трассой.

## 9. Фаза 5 — baseline-прогон + отчёт владельцу

Чистка кэшей/дедупов (§3) → `run` → `judge` → `report` на 85 + свежие ~15. Зафиксировать конфигурацию.

**Отчёт владельцу** (`task-stand-report.md` + разбор): scorecard по механизмам; **вердикт по Т1–Т10** (что
подтвердилось как баг → в ТЗ фикса, что снято); статус инвариантов; честный разбор потолка (что лечится
рычагами, что — отдельные системы). Сверить факт с прогнозом §0 (Т1/Т2/Т3 подтвердятся, INV-1 соблюдётся);
резкое расхождение → сначала диагноз `ruler-defect`.

**Acceptance ТЗ (общая):**
- [ ] `bun run scripts/task-stand/stand.ts all` гоняет 85 сценариев по-фазно и целиком;
- [ ] setup-задачи + манифест ground truth на месте; эмбеддинги готовы;
- [ ] замер Т1 снят (какой извлекатель жив/мёртв) — явно в отчёте;
- [ ] baseline-отчёт: scorecard по 4 механизмам + оси + **статус INV-1..4** + **таблица Т1–Т10** + конфиг;
- [ ] каждый провал сверен с сырой трассой (не с флагом линейки);
- [ ] `typecheck/lint/build` зелёные по затронутому; прод-поведение не тронуто; `task-stand.md` README написан;
- [ ] строка в реестре стендов `stand-methodology.md` §5 добавлена; в `apply-prod-deploy.ts`/`prod-deploy-log`
      НЕ добавлять.

## 10. Операционные ловушки (учесть обязательно — методология §3 + картография §9)

- **Живой backend для Ф2** (конвейер in-process) — иначе `pollUntil` не сойдётся.
- **Эмбеддинги setup-задач** — ждать `issue-embed.worker` (`embedding IS NOT NULL`), иначе KNN-дедуп/закрытие
  молча дают no_match/nil (ложный WRONG_OUTCOME).
- **Классификатор signalType** для journal/closure нестабилен — дублировать прямой инъекцией IdeaBlock с нужным
  signalType, чтобы изолировать петлю закрытия от ingest-классификатора.
- **Т1 неопределённость** — обязательно раздельный прямой вызов трёх извлекателей; не полагаться на то, что
  штатный поток создаст задачу.
- **jobId-дедуп/answer-кэш/probe-dedup/SETNX** — чистить перед каждым прогоном (§3).
- **Недетерминизм LLM** ±3-5 п.п. на 85 — дельта такого размера не вывод; целевые сценарии чинятся поимённо.
  `loadPersonSubgraph`/KNN без стабильного orderBy — фиксировать, кратные прогоны для near-threshold (D-12/D-13).
- **assertNotProd первым**; ORG из ENV (не хардкод); per-run архив, не перезапись.
- **Стендовые скрипты — НЕ прод:** в `apply-prod-deploy.ts STEPS` и `prod-deploy-log` не вносить (кроме
  возможной аддитивной трассы прод-кода — отметить в журнале, что prod-операций не требует).
- **`createPrismaClient()`**, не голый `new PrismaClient()` (Prisma 7).

## 11. Что дальше (НЕ в этом ТЗ)

ТЗ-фикс «Разворот трекинга» — **отдельный файл ПОСЛЕ baseline**, по подтверждённым Т1–Т10 (напр.: Т1 — добить
подключение унифицированного извлекателя / убрать легаси; Т2 — обещание себе в Tasks; Т3 — кросс-блок дедуп;
Т5 — крутилки дедупа в AdminSetting). Петля §2.7 методологии до планки. Дефекты линейки (ruler-defect) — чинятся
в стенде первыми, до фиксов продукта.

## Итог

Реализовано: —/— (по фазам). Стенд меряет 4 механизма трекинга на 85 синтетических входах через реальный
конвейер, сверяет с ground-truth манифестом, судит панелью и печатает baseline с атрибуцией по механизму +
статусом инвариантов R13/изоляции/инъекции/идемпотентности + вердиктом по 10 гипотезам-багам.
