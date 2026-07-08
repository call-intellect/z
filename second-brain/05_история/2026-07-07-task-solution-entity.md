---
date: 2026-07-07
type: reflection
feature: task-solution-entity
tz: plans/tz/2026-07-07-task-solution-entity.md
commits: [82d01f8a, 1d1d0c3c, b08b8c4a, 0f13c3ca, 2c7d2fcc, e39a2c2d]
---

# Рефлексия — сущность «Решение задачи» (TaskSolution), Ф1–Ф7

## Что было поставлено
Реализовать по ТЗ `2026-07-07-task-solution-entity.md` новую сущность памяти компании — материализовать «как решали конкретную задачу» отдельной просматриваемой единицей `TaskSolution` (название · описание · как решалась · исполнитель-владелец · ссылка на задачу), собирать суточным сводом, показать отдельной вкладкой, не ломая кормление клона. Заперты решения владельца: отдельная сущность (не 6-й вид регламента), двойное назначение, без слияния дублей (повтор→кандидат в инструкцию), точка входа — суточная сборка, владелец=исполнитель (ось A4), вкладка.

## Как решал (оркестрация, фаза за фазой)
Вёл как `tz-orchestrator`: сначала параллельная картография 11 подсистем-образцов (Workflow, 11 Explore-агентов), потом фаза за фазой — точный промпт кодеру → своя приёмка (греп + re-Read + typecheck/lint/build/тесты) → коммит.

- **Ф1 данные** (`82d01f8a`): модель `TaskSolution` (schema.prisma) + рукописная миграция `20260707120000_add_task_solution` + back-relations (Org/Person/Issue/CardVersion) + HNSW-индекс в postgres-init.
- **Ф2 сборка** (`1d1d0c3c`): вид компилятора `task_solution` (+снапшот); `TaskSolutionBuildService` (детекция задач с how-solved сигналами дня, владелец=assignee→Person, гейт содержательности, компиляция, upsert, CardVersion, embedding) + суточный крон `TaskSolutionBuildCron` + unit/integration.
- **Ф3 повтор→кандидат** (`b08b8c4a`): cosine-KNN по `task_solutions`, группа ≥ порога → `repeatGroupKey` + `candidateInstruction`, без авто-создания инструкции.
- **Ф4 API** (`0f13c3ca`): модуль `task-solutions` (controller+service+dto, 8 эндпоинтов), pure-Zod, RBAC через объект 'regulation', audit-константы.
- **Ф5 frontend** (`2c7d2fcc`): слои api→domain→ui, страница `/task-solutions` (master-detail, карточка, бейдж повтора, deep-link на задачу), пункт навигации.
- **Ф6 крутилки/флаг/деплой** (`e39a2c2d`): 6 ключей AdminSetting + kill-switch `aiFeatures.taskSolutionEnabled` + сид + STEPS + feature-flags + prod-deploy-log.
- **Ф7 second-brain**: data-model/module-map/ai-jobs/workers-queues/api-layer/frontend-pages + реестр не-сделанного + статус ТЗ.

## Что вышло (верификация)
- backend: полный `typecheck` зелёный; `39` тестов (build-сервис unit+integration, витрина, компилятор-снапшот) зелёные; `eslint` 0 errors; миграция применена локально (физически `vector(1536)`); сид идемпотентен (2-й прогон created:0).
- frontend: `build` проходит (`/task-solutions` prerendered), `typecheck` чист (кроме stale `.next`-артефакта), `lint` 0 errors, 8 domain-тестов зелёные.
- Поведение клона не тронуто (те же блоки reasoning/methodology_step продолжают кормить SkillProfile — TaskSolution лишь дополнительный потребитель).

## Чему научился (ловушки, стоившие разбирательства)
1. **`Unsupported("vector(768)")` в schema.prisma — косметика; физически колонки `vector(1536)`.** ТЗ требовал 1536; два картографа противоречили (один «768», другой «write-запросы 1536»). Разрешил фактами: миграция `add_instruction` физически создаёт `vector(1536)`, все raw-записи кастуют `::vector(1536)`. Правило: **в schema писать `vector(768)` (как соседи), в миграции физически `vector(1536)`, raw-записи `::vector`.** Prisma не диффит размерность Unsupported-типов. → [[code-pitfalls]].
2. **Привязка блок↔задача НЕ прямая.** `IdeaBlock` не имеет `contextCardId`/`sourceIssueId`; связь идёт через `IdeaBlockEvidence.rawEvent.payload.contextCardId` = issue.id (кладёт ingest-адаптер для ответов опроса `task.method_capture`). ТЗ-якорь «contextCardId на блоке» был неверен — пришлось строить raw-SQL join (прямого запроса «блоки по issueId» в коде не было).
3. **`maybeApplyMethodCaptureAnswer` НЕ создаёт блоки** — только ставит `issue.methodCapturedAt`. Блоки рождает generic-путь ingest с `signalTypeHint:'reasoning'`; финальный signalType назначает LLM.
4. **Якоря ТЗ по владельцу/компилятору были неточны.** `specialist-3-1-regulations` НЕ вызывает `OwnerResolverService` (у него свои методы); `regulation-consolidator` — это дедуп, а компилятор вызывается в `specialist-3-1-regulations.upsertRegulation`. Владельца для TaskSolution взял из `Issue.assignees`→`Person` (ось A4: решавший, не упомянутый).
5. **AdminSetting-реестр — `Map<key, ZodSchema>`**, метаданные (label/группа/severity/default) живут в сид-скриптах, UI-поле автогенерится из типа. Крутилка читается `getDynamic(key, undefined, default)` — работает и без записи в реестре (фолбэк на default), реестр нужен для валидации при записи из админки.
6. **Модуль regulations — pure Zod + ZodValidationPipe + interface-DTO**, не `nestjs-zod`/`createZodDto` (вопреки формулировке ТЗ). Зеркалил именно рабочий паттерн.
7. **RBAC не имеет типа `task_solution`** → переиспользовал объект `'regulation'` (та же граница «память компании»), чтобы не плодить policy.csv-churn.

## Открытые хвосты
- Авто-создание Инструкции из повтора решений — намеренно НЕ делается (Q3): только `candidateInstruction` + `repeatGroupKey`. Строка в `04_не-сделано`.
- «Дневные упоминания без опроса» ловятся тем же путём `RawEvent.payload.contextCardId` — надёжная привязка есть только когда ingest проставил contextCardId к задаче (ответы опроса + notification-контекст); произвольный чат без контекста задачи к решению не привяжется. Достаточно для ядра (опрос + контекстные упоминания).
