---
type: tz
status: draft
feature: Фаза 0 — Должности, каркас компании и знакомство
date: 2026-05-21
umbrella: true
children:
  - tz/2026-05-21-phase-0a-data-model-and-graph-infra.md (не создан)
  - tz/2026-05-21-phase-0b-document-ingest.md (не создан)
  - tz/2026-05-21-phase-0c-onboarding-wizard-frontend.md (не создан)
  - tz/2026-05-21-phase-0d-role-profile-agent.md (не создан)
related:
  - analysis/2026-05-21-user-cabinet-design.md (draft — пишется после ревью зонтичного, до 0c)
---

# ТЗ: Фаза 0 — Должности, каркас компании и знакомство (зонтичный документ)

> **Это зонтичный документ.** Он фиксирует цель, scope, матрицу прослеживаемости решений из анализа и карту четырёх sub-TZ. Сами sub-TZ (0a, 0b, 0c, 0d) — отдельные документы. Этот файл — точка контроля «ничего не потеряли» **до** старта объёмной работы.
>
> **Анализ — источники:**
> - [2026-05-21-ontology-process-regulation.md](../analysis/2026-05-21-ontology-process-regulation.md) — целевая онтология, разделы 6 (Role-first onboarding), 8 (Решённые вопросы), 10 (Каркас 5 уровней), 11 (Векторное выравнивание). **Итерации 14 и 15 фиксируют ключевые решения этой Фазы 0: AGE-инфраструктура внутри Фазы 0; полный каркас 5 уровней как пустые слоты в БД с первого дня.**
> - [2026-05-21-z-gap-analysis-to-memory-layer.md](../analysis/2026-05-21-z-gap-analysis-to-memory-layer.md) — gap-анализ, слои 1 (Ingestion), 3 (Storage), 7 (Permissions), 9 (Agents).
> - [`plans/analysis/2026-05-21-user-cabinet-design.md`](../analysis/2026-05-21-user-cabinet-design.md) _(draft, создан 2026-05-21)_ — структура личного кабинета, навигация, иерархия страниц, мастер знакомства. Закрывает 10 ключевых развилок и фиксирует расширения скопа Фазы 0 (`/dump` минимальный, `/me` минимальный, multi-org switcher, 4 preview-страницы γ). Sub-TZ 0c пишется на основе этой аналитики.
>
> **При расхождениях** между этим зонтичным документом и анализом — приоритет у анализа. Этот файл — оперативная карта Фазы 0, не источник правды по решениям.

---

## 1. Цель

После Фазы 0 в Z работает **первая бизнес-онтология компании клиента** + **полный каркас сущностей 5 уровней** как пустые слоты в схеме БД:

- **Видимая часть (то, что пользователь делает руками через мастер знакомства):** регистрация Org → отделы → должности → сотрудники → загруженные должностные инструкции (PDF / DOCX / Markdown). Для каждой должности система начинает накапливать **карту должности** (`RoleProfile`) — материализованный кеш «кто на роли, что делает, какие навыки и решения характерны». Карта пустая в момент создания и заполняется автоматически из загруженных документов и встреч через существующий `knowledge-core`.
- **Невидимая часть (слоты для автоматического извлечения, без UI в Фазе 0):** в БД заведены модели всех уровней каркаса компании — Mission, Vision, Strategy, Process, ProcessStep, Regulation, Policy, Tool, Metric, Decision. Extraction-LLM знает эти типы и при разборе встреч/документов сохраняет соответствующие сущности и типизированные связи в графе AGE. UI для просмотра и редактирования этих сущностей появится в Фазе γ; в Фазе 0 они наполняются автоматически и видны только в карте должности (через RoleProfileAgent) и в результатах knowledge search.

Это первый артефакт «памяти компании», от которого растут все остальные слои. К моменту Фазы γ в БД уже есть данные правильной формы — никакой миграции из «Entity с type=custom» не требуется.

---

## 2. Scope

### Входит в Фазу 0

**А. Бизнес-сущности с UI в Фазе 0 (видимая часть мастера и дашборда):**
- `Department` — отдел компании с плоским списком и nullable `parentDepartmentId` (иерархия в схеме, но не в UI).
- `Role` — должность в компании клиента (бизнес-сущность, не путать с `Membership.role` из Casbin).
- `Person` — расширение существующей сущности связями с Role и Department.
- `JobDescription` — declared-форма должности (текст + ссылка на исходный документ).
- `Skill` — навык, переиспользуется между ролями и людьми.
- `Document` — загруженный документ (PDF / DOCX / Markdown).
- `RoleProfile` — материализованный кеш «карта должности».

**Б. Слоты сущностей без UI в Фазе 0 (только модели + extraction + entity resolution):**

Полный каркас 5 уровней основы компании из раздела 10 анализа онтологии. Эти сущности создаются автоматически при разборе встреч и документов, но снаружи (через UI) ни заводить, ни редактировать их в Фазе 0 нельзя:

- **Уровень 1 «Зачем»:** `Mission`, `Vision`, `Strategy` — структурированные модели (markdown + поля markets/bets/horizon/targetDate).
- **Уровень 3 «Как работа течёт»:** `Process`, `ProcessStep`, `Regulation` (с `category enum (regulation | standard)`), `Policy`.
- **Уровень 4 «На чём работает»:** `Tool` (отдельная модель; `Data` / `Knowledge` каркаса — концептуальные понятия, моделями не становятся).
- **Уровень 5 «Учится»:** `Metric` (отдельная модель); `Review` / `Retrospective` — через расширение существующего `MeetingType` enum (значения `review`, `retrospective`).
- **Дополнительно вне каркаса:** `Decision` — критично для миграционного долга (сейчас «размазан» как `IdeaBlock.signalType='decision'`).

`ChangeRequest` остаётся в Фазе δ (специализация `Inquiry`).

**В. Графовая инфраструктура:**
- Apache AGE — расширение PostgreSQL, ставится как часть Фазы 0 (см. анализ онтологии, раздел 8, итерация 14).
- Сервис `GraphService` в `backend/src/common/graph/` — единая точка работы с графом.
- Единая модель рёбер `EntityLink(fromId, fromType, toId, toType, linkType, validFrom, validTo, properties)` — двойная запись в PostgreSQL и AGE в одной транзакции.
- Полный набор типов рёбер для каркаса 5 уровней: `realized_by`, `decomposes_into`, `measured_by`, `executed_by`, `has_step`, `owned_by`, `lives_in`, `produces`, `triggered_by`, `regulates`, `constrains`, `applies_to`, `responsible_for` / `accountable_for` / `consulted_on` / `informed_about` (RACI).

**Г. Прикладные слои:**
- Расширение модуля `ingest/` адаптером для документов.
- Парсер PDF / DOCX / Markdown.
- Мастер знакомства на frontend (5 шагов) + дашборд компании + страницы списков сущностей группы А.
- `RoleProfileAgent` MVP — BullMQ-воркер, генерирует `RoleProfile` по cron + on-demand.
- Расширение RBAC: новые `ResourceType` для всех новых сущностей (включая слоты).
- Расширение глоссария UI (`delivery/13-glossary.md`, `delivery/ui/copy-strings.ru.md`) русскими названиями новых сущностей группы А (термины для группы Б — добавятся в γ, когда появится UI).
- **Расширение `BlockExtractionService`** на распознавание всех новых типов из группы Б (возможно — разбивка на несколько extraction-проходов, см. открытый вопрос §6).
- **Расширение `EntityResolutionService`** на дедуп новых типов из группы Б (доменные правила: одно название процесса / регламента / решения в рамках Org = одна сущность).

**Д. Расширение существующих моделей:**
- `Goal.horizon` (новый enum: strategic / annual / quarterly / monthly / sprint).
- `Goal.parentGoalId` (декомпозиция целей).
- `MeetingType` — добавить значения `review`, `retrospective`.
- Эти расширения — бесплатная подготовка к Фазе γ.

### Не входит в Фазу 0

- **CRUD-страницы, админка и витрины для сущностей группы Б** (Mission/Vision/Strategy/Process/ProcessStep/Regulation/Policy/Tool/Metric/Decision) — Фаза γ. В Фазе 0 они **есть в БД и наполняются автоматически**, но снаружи через UI с ними работать нельзя.
- Bi-temporal layer (`valid_from` / `valid_to` для узлов, temporal walk) — Фаза α (после Фазы 0).
- ABAC на уровне фактов (`FactAcl`) — Фаза β.
- Динамическая онтология (`OntologyType` модель) — Фаза γ.
- `CuratorAgent` и `Inquiry` — Фаза δ.
- `ChangeRequest` (специализация `Inquiry`) — Фаза δ.
- Адаптеры ingest для CRM / task-tracker / wiki / Git / 1С — Фаза ε.
- Остальные специализированные агенты (RoleClone, ProcessNarrator, DecisionArchaeologist, AlignmentAgent и т.д.) — Фаза ζ.
- Query planner LLM + MCP-сервер — Фаза η.
- Дельта Declared vs Observed для процессов и ролей — Фаза γ + ζ.
- UI для назначения RACI — типы связей заведены, но интерфейс — γ.
- Шаблоны компаний по индустриям в мастере — отказались на старте (раздел 6.6, итерация 8).
- Иерархия отделов в UI — поле `parentDepartmentId` есть в схеме, UI пока плоский список.
- Иерархия должностей (`has_subordinate`) — связь определена в анализе, но UI и enforcement — на потом.
- `Standard` как отдельная модель — реализуется через `Regulation.category='standard'`.
- `Data` / `Knowledge` уровня 4 как отдельные модели — концептуальные понятия, моделями не становятся.

---

## 3. Карта четырёх sub-TZ

### 0a — Фундамент: модели данных + графовая инфраструктура + API + RBAC

**Файл:** `plans/tz/2026-05-21-phase-0a-data-model-and-graph-infra.md` _(не создан)_

**Scope:**
- Все Prisma-модели группы А (Role, Department, JobDescription, Skill, Document, RoleProfile, Person-расширение).
- Все Prisma-модели группы Б (Mission, Vision, Strategy, Process, ProcessStep, Regulation, Policy, Tool, Metric, Decision).
- Расширения существующих моделей (Goal.horizon, Goal.parentGoalId, MeetingType +2 значения).
- Установка Apache AGE; сервис `GraphService`; единая модель рёбер `EntityLink` с двойной записью.
- Полный набор типов рёбер для каркаса 5 уровней.
- CRUD-эндпоинты по сущностям группы А (для UI Фазы 0).
- Внутренние API для записи сущностей группы Б через extraction (без публичного CRUD).
- Расширение RBAC на все новые ResourceType (включая слоты группы Б — даже без UI, права на чтение через knowledge search должны быть корректны).

**Входы:** нет (это базовый блок, от него зависят все остальные sub-TZ).

**Выходы наружу (контракт):**
- Имена Prisma-моделей и их полей — финальные после 0a, не меняются в 0b/0c/0d.
- API-эндпоинты группы А (CRUD): `/api/v1/roles`, `/api/v1/departments`, `/api/v1/job-descriptions`, `/api/v1/skills`, `/api/v1/documents`, `/api/v1/role-profiles`.
- Внутренние API для extraction: `GraphService.upsertEntity({ type, data, sourceProvenance })` — для всех типов группы Б.
- API `GraphService` (`addNode`, `addEdge`, `removeEdge`, `traverse`, `findPath`, `getNeighbors`).
- События BullMQ при создании сущности (`role.created`, `document.uploaded`, `process.created` и т.д.) — на них подписывается 0b и 0d.

**Покрывает строки матрицы:** 1–25 + 43–62 (группа H).

---

### 0b — Document-ingest pipeline + extraction типизированных сущностей

**Файл:** `plans/tz/2026-05-21-phase-0b-document-ingest.md` _(не создан)_

**Scope:**
- Новый адаптер `document.adapter` в существующем `ingest/`.
- Парсер PDF / DOCX / Markdown; сохранение исходника в S3 (`documents/<tenantId>/<documentId>.bin`).
- Создание `RawEvent` + `Document`-сущности; статус-машина документа.
- **Расширение `BlockExtractionService`** на распознавание всех новых типов группы Б — JSON-схема ответа LLM возвращает не только `IdeaBlock`-и, но и типизированные сущности (Process, Decision, Regulation, Policy, Metric, Tool, опционально Mission/Vision/Strategy).
- Возможна разбивка на несколько extraction-проходов: первый — `IdeaBlock`-и; второй — типизированные сущности; третий — связи между ними. Окончательное решение — в начале sub-TZ 0b (открытый вопрос §6).
- **Расширение `EntityResolutionService`** на дедуп новых типов: одно название процесса/регламента/решения в рамках Org = одна сущность.
- Пометка `role_relevant: bool` + `roleId?` на `IdeaBlock`-ах для последующей работы `RoleProfileAgent`.

**Входы:** модели `Document`, `RawEvent`, все модели группы Б из 0a; `GraphService.upsertEntity` API; события `document.uploaded` из 0a.

**Выходы наружу:**
- Сохранённый `Document` + распарсенный текст + извлечённые `IdeaBlock`-и со связями к `Role` (linkType=`role_relevant`).
- Извлечённые типизированные сущности группы Б, сохранённые через `GraphService.upsertEntity` с провенансом (`sourceDocumentId`, `sourceIdeaBlockId`).
- Прогресс-эвенты для UI (полл/SSE — решается на старте 0b, открытый вопрос §6).

**Покрывает строки матрицы:** 26–31 + 63–66 (расширения extraction и entity resolution).

---

### 0c — Мастер знакомства + личный кабинет Фазы 0 (frontend)

**Файл:** `plans/tz/2026-05-21-phase-0c-onboarding-wizard-frontend.md` _(не создан)_

**Зависит от аналитики ЛК:** `plans/analysis/2026-05-XX-user-cabinet-design.md` (пишется до 0c).

**Scope:**
- Мастер из 5 шагов на frontend (UX по аналитике ЛК).
- Главные страницы личного кабинета Фазы 0: дашборд компании, «Структура» (Отделы / Должности / Сотрудники), «Документы», «Карты должностей» (список + детальная страница).
- Навигация ЛК с заделом под Фазу γ (разделы «Цели», «Процессы», «Регламенты», «Политики», «Метрики» уже видны в навигации, но кликабельны только в γ).
- Обновление глоссария UI новыми терминами группы А.
- Все строки UI — на русском без английских слов (правило `feedback_admin_ui_russian_only.md`).

**Входы:** API группы А из 0a; прогресс-эвенты из 0b; аналитика ЛК.

**Выходы наружу:** пользователь после wizard'а попадает в полноценный ЛК Фазы 0 — видит структуру компании, может просматривать документы и карты должностей.

**Покрывает строки матрицы:** 32–36 + 67–68 (заделы под γ в навигации).

---

### 0d — RoleProfileAgent MVP

**Файл:** `plans/tz/2026-05-21-phase-0d-role-profile-agent.md` _(не создан)_

**Scope:** BullMQ-воркер `role-profile.worker`; cron-расписание; on-demand-вызов через API; Cypher-запрос «всё, что касается роли» через `GraphService` (обход в 4–5 хопов через Role → Person → Event → IdeaBlock + опционально Process/Decision/Regulation, если они уже наполнены); промпт для LLM через существующий `LlmRouterService` (`taskType='role-profile-build'`); запись результата в `RoleProfile.summaryCache`.

**Входы:** модель `RoleProfile`, `GraphService`, события из 0b (новые блоки идей с пометкой `role_relevant`, новые сущности группы Б).

**Выходы наружу:** заполненный `RoleProfile` со структурой `responsibilities[]` + `skills[]` + `decision_patterns[]` + `common_pitfalls[]` + `style_profile`. Виден на странице должности (0c).

**Покрывает строки матрицы:** 37–42.

---

## 4. Матрица прослеживаемости

Каждая строка — решение или артефакт из анализа, который должен быть реализован в Фазе 0. Колонка «Источник» указывает на конкретный раздел анализа; колонка «Где» — на номер sub-TZ. Колонка «Статус» — `[ ]` или `[x]`, синхронизируется по мере реализации.

### A. Модели данных

| № | Решение / артефакт | Источник | Где | Статус |
|---|---|---|---|---|
| 1 | Модель `Department(id, orgId, name, parentDepartmentId nullable, createdAt, updatedAt)` | онтология §8 итерация 14, §10 «Уровень 2» | 0a | [ ] |
| 2 | Модель `Role(id, orgId, name, departmentId nullable, tags[], createdAt, updatedAt)` — плоский список без иерархии в UI | онтология §6.4, §6.6 итерация 8 | 0a | [ ] |
| 3 | Модель `JobDescription(id, orgId, roleId, contentMd Text, sourceDocumentId nullable, version, createdAt, updatedAt)` | онтология §6.1 шаг 4, §6.4 | 0a | [ ] |
| 4 | Модель `Skill(id, orgId, name, description nullable, createdAt, updatedAt)` — отдельный тип Entity, переиспользуется | онтология §6.4, §6.6 итерация 8 | 0a | [ ] |
| 5 | Модель `Document(id, orgId, kind, name, mimeType, s3Key, originalSize, parsedText Text, status, createdAt, updatedAt)` | онтология §6.4 | 0a | [ ] |
| 6 | Модель `RoleProfile(id, orgId, roleId, summaryCache Json, lastBuildAt, buildVersion, createdAt, updatedAt)` — материализованный кеш | онтология §6.3 | 0a | [ ] |
| 7 | Существующая модель `EntityLink` приведена к виду `(fromId, fromType, toId, toType, linkType, validFrom, validTo, properties Json)` — единая модель рёбер для всех бизнес-связей | онтология §8 итерация 14 | 0a | [ ] |
| 8 | Расширение `Goal.horizon: GoalHorizon` — новый enum (`strategic, annual, quarterly, monthly, sprint`) | онтология §11.6 | 0a | [ ] |
| 9 | Расширение `Goal.parentGoalId nullable` — декомпозиция | онтология §11.6 | 0a | [ ] |
| 10 | Явный комментарий в `schema.prisma`: `Membership.role` ≠ бизнес-сущность `Role` — это две разных модели (Membership.role = права доступа в Z; Role = должность в компании клиента) | онтология §8 итерация 10 | 0a | [ ] |

### B. Графовая инфраструктура

| № | Решение / артефакт | Источник | Где | Статус |
|---|---|---|---|---|
| 11 | Установка Apache AGE как расширения PostgreSQL (`CREATE EXTENSION age`); миграция через `bun run apply-postgres-init` | онтология §8 итерация 14, gap-анализ §3 | 0a | [ ] |
| 12 | Сервис `GraphService` в `backend/src/common/graph/` — API `addNode`, `addEdge`, `removeEdge`, `traverse`, `findPath`, `getNeighbors`. Cypher только через этот сервис | онтология §8 итерация 14 | 0a | [ ] |
| 13 | Двойная запись в `EntityLink` (Postgres) и AGE (граф) в одной транзакции через `GraphService` | онтология §8 итерация 14 | 0a | [ ] |
| 14 | Запрет прямого использования Cypher из бизнес-сервисов (только через `GraphService`) — фиксируется как architectural decision в `02_architecture/code-pitfalls.md` | онтология §8 итерация 14 | 0a | [ ] |

### C. Бизнес-связи (типизированные рёбра)

| № | Связь | Источник | Где | Статус |
|---|---|---|---|---|
| 15 | `Person -[executes_role {from, to}]-> Role` — many-to-many с временным интервалом | онтология §6.4, §6.6 итерация 8 | 0a | [ ] |
| 16 | `Role -[belongs_to]-> Department` | онтология §10 | 0a | [ ] |
| 17 | `Person -[member_of]-> Department` | онтология §10 | 0a | [ ] |
| 18 | `Role -[described_by]-> JobDescription` | онтология §6.4 | 0a | [ ] |
| 19 | `JobDescription -[derived_from]-> Document` | онтология §6.4 | 0a | [ ] |
| 20 | `Role -[requires_skill]-> Skill` | онтология §6.4 | 0a | [ ] |
| 21 | `Person -[has_skill {observed_at, confidence}]-> Skill` | онтология §6.4 | 0a | [ ] |
| 22 | `Role -[is_responsible_for]-> Process` — связь определена в анализе, но `Process` first-class только в Фазе γ; в Фазе 0 хранение пустое, тип ребра объявлен | онтология §6.4 | 0a (объявить тип), не наполнять | [ ] |

### D. API и RBAC

| № | Решение / артефакт | Источник | Где | Статус |
|---|---|---|---|---|
| 23 | REST-эндпоинты CRUD по `/api/v1/roles`, `/api/v1/departments`, `/api/v1/job-descriptions`, `/api/v1/skills`, `/api/v1/documents`, `/api/v1/role-profiles` (последний — read-only через агент) | онтология §6.1 шаг 5 | 0a | [ ] |
| 24 | Расширение RBAC: новые `ResourceType` — `role`, `department`, `job-description`, `skill`, `document`, `role-profile`; правила в `policies/policy.csv` | gap-анализ §7 | 0a | [ ] |
| 25 | Default owner всех новых сущностей = Org owner + admin; per-Role можно назначить дополнительного owner-а (например, вышестоящую Role) | онтология §6.6 итерация 8 | 0a | [ ] |

### E. Document ingest pipeline

| № | Решение / артефакт | Источник | Где | Статус |
|---|---|---|---|---|
| 26 | Новый адаптер `document.adapter.ts` в `backend/src/modules/ingest/adapters/` | онтология §6.1 шаг 4, gap-анализ §1 | 0b | [ ] |
| 27 | Парсер PDF / DOCX / Markdown (выбор библиотеки — открытый вопрос §6 ниже) | gap-анализ §1 | 0b | [ ] |
| 28 | Сохранение исходника: inline ≤10 MiB, иначе S3 `documents/<tenantId>/<documentId>.bin` (по существующему паттерну `RawEvent`) | gap-анализ §1 | 0b | [ ] |
| 29 | `Document.parsedText` заполняется парсером; `Document.status` отслеживает этапы (`uploaded → parsing → parsed → blocks-extracted → failed`) | gap-анализ §1 | 0b | [ ] |
| 30 | Расширение `BlockExtractionService`: JSON-схема ответа LLM получает поля `role_relevant: bool` + `roleId?: string` — классификатор role-relevance в момент разбора | онтология §6.6 итерация 8 | 0b | [ ] |
| 31 | Связь `JobDescription -[derived_from]-> Document` устанавливается при загрузке должностной через wizard (документ загружается на конкретную должность) | онтология §6.4 | 0b (логика) + 0c (UI) | [ ] |

### F. Мастер знакомства (frontend)

| № | Решение / артефакт | Источник | Где | Статус |
|---|---|---|---|---|
| 32 | Мастер из 5 шагов: «Опишите отделы» → «Заведите должности» → «Заведите сотрудников» → «Загрузите должностные инструкции» → «Готово, открываем дашборд». Без шаблонов индустрий | онтология §6.1, §6.6 итерация 8 | 0c | [ ] |
| 33 | CSV-импорт сотрудников — опционально, после ручного ввода. Решить в открытом вопросе перед 0c | онтология §6.1 шаг 3 | 0c | [ ] |
| 34 | Дашборд компании после wizard'а: карточки должностей с пометкой «карта пустая, ждёт данных» пока `RoleProfileAgent` не наполнил | онтология §6.1 шаг 5 | 0c | [ ] |
| 35 | Все строки UI на русском без английских слов; глоссарий пополнен (см. строку 36) | feedback_admin_ui_russian_only.md, §8 итерация 11 | 0c | [ ] |
| 36 | Расширение `delivery/13-glossary.md` и `delivery/ui/copy-strings.ru.md` новыми терминами: Должность, Отдел, Должностная инструкция, Навык, Документ, Карта должности, Сотрудник на должности, Знакомство с компанией (мастер) | онтология §8 итерация 11 | 0c | [ ] |

### G. RoleProfileAgent

| № | Решение / артефакт | Источник | Где | Статус |
|---|---|---|---|---|
| 37 | BullMQ-воркер `role-profile.worker` в `backend/src/workers/`, concurrency=1, idempotencyKey по `roleId+buildVersion` | gap-анализ §9 | 0d | [ ] |
| 38 | Cron-расписание: например, раз в час (`@Cron('0 * * * *')`) — точное значение решить в открытом вопросе перед 0d | gap-анализ §9 | 0d | [ ] |
| 39 | On-demand вызов через API `POST /api/v1/role-profiles/:roleId/rebuild` | gap-анализ §9 | 0d | [ ] |
| 40 | Cypher-запрос «собрать всё, что касается роли» через `GraphService`: обход Role → Person → Event → IdeaBlock → Theme/Decision (4–5 хопов) | онтология §6.3, §8 итерация 14 | 0d | [ ] |
| 41 | Структура `RoleProfile.summaryCache`: `{ responsibilities[], skills[], decision_patterns[], common_pitfalls[], style_profile }` | онтология §6.3 | 0d | [ ] |
| 42 | Промпт `role-profile-build` в существующем prompt registry; LLM-вызов через `LlmRouterService` (`taskType='role-profile-build'`) | gap-анализ §9 | 0d | [ ] |

### H. Слоты сущностей каркаса 5 уровней (без UI в Фазе 0)

| № | Решение / артефакт | Источник | Где | Статус |
|---|---|---|---|---|
| 43 | Модель `Mission(id, orgId, contentMd, markets Json?, bets Json?, horizon, targetDate, createdAt, updatedAt)` | онтология §10 «Уровень 1», §8 итерация 15 | 0a | [ ] |
| 44 | Модель `Vision(id, orgId, contentMd, horizonYears, targetDate, createdAt, updatedAt)` | онтология §10 «Уровень 1», §8 итерация 15 | 0a | [ ] |
| 45 | Модель `Strategy(id, orgId, contentMd, markets Json, bets Json, horizon, targetDate, createdAt, updatedAt)` | онтология §10 «Уровень 1», §8 итерация 15 | 0a | [ ] |
| 46 | Модель `Process(id, orgId, name, description, ownerRoleId nullable, ownerPersonId nullable, triggerDescription nullable, slaMinutes nullable, status enum, createdAt, updatedAt)` | онтология §10 «Уровень 3», §8 итерация 15 | 0a | [ ] |
| 47 | Модель `ProcessStep(id, orgId, processId, name, order Int, description nullable, slaMinutes nullable, createdAt, updatedAt)` | онтология §10 «Уровень 3», §8 итерация 15 | 0a | [ ] |
| 48 | Модель `Regulation(id, orgId, name, contentMd, category enum (regulation, standard), status enum, version Int, createdAt, updatedAt)` — Standard через `category='standard'` | онтология §10 «Уровень 3», §8 итерация 10, §8 итерация 15 | 0a | [ ] |
| 49 | Модель `Policy(id, orgId, name, contentMd, severity enum, status enum, createdAt, updatedAt)` | онтология §10 «Уровень 3», §8 итерация 15 | 0a | [ ] |
| 50 | Модель `Tool(id, orgId, name, kind enum, externalUrl nullable, createdAt, updatedAt)` | онтология §10 «Уровень 4», §8 итерация 15 | 0a | [ ] |
| 51 | Модель `Metric(id, orgId, name, description nullable, unit, target nullable, valueType enum, createdAt, updatedAt)` | онтология §10 «Уровень 5», §8 итерация 10, §8 итерация 15 | 0a | [ ] |
| 52 | Модель `Decision(id, orgId, text, rationale nullable, decidedAt, decidedByPersonId nullable, sourceMeetingId nullable, sourceIdeaBlockId nullable, status enum, createdAt, updatedAt)` — критично для миграционного долга | онтология §8 итерация 15 | 0a | [ ] |
| 53 | Расширение существующего `MeetingType` enum значениями `review`, `retrospective` (вместо отдельных моделей Review/Retrospective) | онтология §8 итерация 15 | 0a | [ ] |
| 54 | Тип ребра `realized_by` (Mission → Strategy) | онтология §10 | 0a | [ ] |
| 55 | Тип ребра `decomposes_into` (Strategy → Goal, Goal → Goal) | онтология §10, §11.6 | 0a | [ ] |
| 56 | Тип ребра `measured_by` (Goal → Metric, Process → Metric) | онтология §10 | 0a | [ ] |
| 57 | Тип ребра `executed_by` (Strategy → Process) | онтология §10 | 0a | [ ] |
| 58 | Типы рёбер для Process: `has_step` (→ ProcessStep), `owned_by` (→ Role/Person), `lives_in` (→ Tool), `produces` (→ Document), `triggered_by` (→ Event/Meeting) | онтология §10 | 0a | [ ] |
| 59 | Тип ребра `regulates` (Regulation → Process) | онтология §10 | 0a | [ ] |
| 60 | Тип ребра `constrains` (Policy → Process/Role/любая сущность) | онтология §10 | 0a | [ ] |
| 61 | Тип ребра `applies_to` (Regulation с `category='standard'` → ArtifactType — пока строка-идентификатор типа артефакта, динамическая онтология типов в Фазе γ) | онтология §10 | 0a | [ ] |
| 62 | Типы рёбер RACI: `responsible_for` / `accountable_for` / `consulted_on` / `informed_about` (Person/Role → ProcessStep) — типы заведены, UI назначения — Фаза γ | онтология §10 «Уровень 2», §8 итерация 10 | 0a (типы), Фаза γ (UI) | [ ] |

### I. Расширения extraction и entity resolution

| № | Решение / артефакт | Источник | Где | Статус |
|---|---|---|---|---|
| 63 | JSON-схема ответа `BlockExtractionService` расширяется секциями для типизированных сущностей группы Б: `processes[]`, `decisions[]`, `regulations[]`, `policies[]`, `metrics[]`, `tools[]`, опционально `mission?`, `vision?`, `strategy?` | онтология §8 итерация 15 | 0b | [ ] |
| 64 | Решение о разбивке extraction на несколько проходов (один промпт vs несколько последовательных) — фиксируется в начале sub-TZ 0b (см. открытый вопрос §6) | онтология §8 итерация 15 | 0b | [ ] |
| 65 | `EntityResolutionService` расширяется на новые типы группы Б: доменные правила «одно название процесса/регламента/политики/инструмента/метрики в рамках Org = одна сущность» + cosine-сравнение названий + LLM-arbiter для пограничных случаев | онтология §8 итерация 15, gap-анализ §4 | 0b | [ ] |
| 66 | `Decision`-узел создаётся параллельно каждому `IdeaBlock` с `signalType='decision'` (двойная запись, idempotent по `sourceIdeaBlockId`) | онтология §8 итерация 15 | 0b | [ ] |

### J. Заделы под Фазу γ в навигации личного кабинета

| № | Решение / артефакт | Источник | Где | Статус |
|---|---|---|---|---|
| 67 | Навигация ЛК с самого начала проектируется с разделами «Цели», «Процессы», «Регламенты», «Политики», «Метрики» — в Фазе 0 эти пункты видны, но при клике показывают заглушку «Раздел появится в следующей фазе» (либо скрыты для не-admin) | онтология §8 итерация 15 | 0c (после аналитики ЛК) | [ ] |
| 68 | После Фазы 0 переход к Фазе γ — это **только добавление страниц**, без переписывания каркаса ЛК | онтология §8 итерация 15 | 0c | [ ] |

---

## 5. Порядок реализации и зависимости

```
Аналитика ЛК ────────────────────────┐
                                     ↓
0a (фундамент) → 0b (document-ingest)  ┐
              → 0c (wizard + ЛК)       ├─→ 0d (RoleProfileAgent)
                                       ┘
```

- **Аналитика ЛК** ([`plans/analysis/2026-05-21-user-cabinet-design.md`](../analysis/2026-05-21-user-cabinet-design.md), draft от 2026-05-21) пишется **между ревью этого зонтичного и стартом sub-TZ 0c**. Закрывает структуру ЛК, навигацию, иерархию страниц. 0a и 0b не блокируются ею (это backend), но **в 0b добавляется `text.adapter`** как побочный продукт `/dump` (см. §11 аналитики).
- **0a — последовательно, первым.** Все остальные блоки зависят от моделей, API и `GraphService`. С учётом расширения на каркас 5 уровней — это самый большой блок Фазы 0 (≈16 новых моделей + ≈17 типов рёбер).
- **0b и 0c — параллельно после 0a.** У них пересечение в строке 31 (загрузка должностной — UI в 0c, обработка в 0b). 0c также блокируется аналитикой ЛК.
- **0d — последним.** Зависит от данных, которые появятся только после 0a (модели) + 0b (блоки идей из документов + типизированные сущности) + хотя бы частично 0c (заведённые должности).

**Не запускать 0d, пока:** на проде нет ни одной заведённой Role с ≥1 связанным `IdeaBlock` (role-relevant). Иначе агент работает на пустоте.

---

## 6. Открытые вопросы перед нарезкой sub-TZ

Эти вопросы блокируют написание соответствующих sub-TZ. Закрываем перед стартом каждого блока.

| № | Вопрос | Кто блокирует | Гипотеза автора |
|---|---|---|---|
| 1 | Парсер документов: `pdf-parse` + `mammoth` (in-process, легко) или Apache Tika (внешний контейнер, мощнее)? | 0b | `pdf-parse` + `mammoth` для MVP — нет нового sidecar; Tika — если упрёмся в качество извлечения таблиц или сканов |
| 2 | Apache AGE в dev-окружении: есть ли он в нашем `docker-compose.yml` для разработки? Поддерживается ли он Yandex Managed PostgreSQL? | 0a | Проверить и зафиксировать в начале 0a; если managed-Postgres не поддерживает — ставим self-hosted PostgreSQL на проде |
| 3 | Cron-расписание `RoleProfileAgent`: раз в час, раз в 4 часа, раз в день? | 0d | Раз в час на старте; если LLM-стоимость растёт — переходим на on-demand only |
| 4 | CSV-импорт сотрудников в Wizard MVP — обязательная фича или nice-to-have? | 0c | Nice-to-have в MVP; включаем если есть запас по времени |
| 5 | Пустая карта должности (только что заведённая Role): пустой `summaryCache` или дефолтный шаблон по типу должности? | 0d | Пустой `summaryCache` + явный статус «карта формируется» в UI; шаблоны по типу — позже |
| 6 | Прогресс-эвенты загрузки документа в UI: SSE, WebSocket или polling? | 0b ↔ 0c | Polling раз в 2 секунды через GET endpoint `Document` — простейший вариант; SSE/WS — если поведение «дёргается» |
| 7 | Иерархия отделов в UI: оставить плоский список в Фазе 0 или сразу делать дерево? Поле `parentDepartmentId` есть, вопрос только про UX | 0c | Плоский список в Фазе 0 (90% компаний); дерево — когда придёт первый клиент с реальной вложенностью |
| 8 | Разбивка extraction на несколько проходов: один промпт возвращает всё (IdeaBlock + типизированные сущности) или последовательные проходы (1: блоки → 2: сущности → 3: связи)? | 0b | На старте 0b сравниваем точность обоих подходов на 5–10 реальных встречах/документах; выбираем по качеству. Гипотеза: для сложных встреч выгоднее несколько проходов |
| 9 | Что делать, когда LLM колеблется между Process / Regulation / Policy для одной упоминаемой сущности? | 0b | Сохраняем как Process с пометкой `confidence < threshold` в metadata; через `CuratorAgent` (Фаза δ) пользователь подтверждает тип. До Фазы δ — пограничные случаи просто помечаются в логах |
| 10 | Заделы под Фазу γ в навигации ЛК: показывать пустые разделы с заглушкой или скрывать совсем для не-admin? | 0c (зависит от аналитики ЛК) | Решается в аналитике ЛК. Гипотеза: для admin — показывать с пометкой «появится в следующей фазе»; для остальных — скрыты |
| 11 | `Mission` / `Vision` / `Strategy` — пытаемся ли извлекать автоматически из загруженных документов компании («о нас», презентация стратегии)? | 0b | На MVP — нет (нет универсального языка распознавания). Слот существует в БД, наполняется в Фазе γ через UI. Если LLM случайно увидит что-то похожее — сохраняется с `confidence < threshold` для ручной проверки в γ |

---

## 7. DoD (критерии готовности всей Фазы 0)

Фаза 0 считается закрытой, когда:

### Технические критерии

- [ ] Все 4 sub-TZ (0a, 0b, 0c, 0d) имеют статус `реализовано полностью` в своём итоговом блоке.
- [ ] Все 68 строк матрицы прослеживаемости имеют статус `[x]`.
- [ ] Все 16 новых моделей (Role, Department, JobDescription, Skill, Document, RoleProfile + Mission, Vision, Strategy, Process, ProcessStep, Regulation, Policy, Tool, Metric, Decision) присутствуют в Prisma-схеме и применены через `bun run prisma:push`.
- [ ] Все 17 типов рёбер (`executes_role`, `belongs_to`, `member_of`, `described_by`, `derived_from`, `requires_skill`, `has_skill`, `realized_by`, `decomposes_into`, `measured_by`, `executed_by`, `has_step`, `owned_by`, `lives_in`, `produces`, `triggered_by`, `regulates`, `constrains`, `applies_to`, `responsible_for`, `accountable_for`, `consulted_on`, `informed_about`) корректно работают в `GraphService` и через AGE-Cypher (smoke-тест).
- [ ] `bun run typecheck` чистый по `backend/` и `frontend/`.
- [ ] `bun run lint` чистый по `backend/` и `frontend/`.
- [ ] `bun run test:unit` + `bun run test:integration` зелёные по затронутым модулям.
- [ ] `bun run build` собирает оба пакета без ошибок.
- [ ] Прогон `skill strict-production-review-gate` пройден по всем новым модулям.

### Бизнес-критерии (продуктовые)

- [ ] Хотя бы 1 пилотная компания прошла мастер знакомства от начала до конца (отдел → должность → сотрудник → загруженная должностная инструкция).
- [ ] Для каждой пилотной компании сгенерирован минимум 1 непустой `RoleProfile` (то есть `RoleProfileAgent` успешно отработал на реальных данных).
- [ ] Время прохождения wizard'а на одной компании ≤ 15 минут (метрика — фиксируем в `core_*` Prometheus).
- [ ] Парсер документов успешно обрабатывает PDF / DOCX / Markdown на тестовом наборе из ≥10 реальных должностных инструкций.
- [ ] Extraction-LLM на тестовом наборе из ≥10 встреч/документов корректно создаёт типизированные сущности группы Б (Process / Decision / Regulation / Policy / Metric) с провенансом (precision ≥ 0.8 по ручной разметке, recall — отдельная метрика, фиксируем но не блокируем DoD).
- [ ] EntityResolution на новых типах: на тестовом наборе из ≥20 пар «одно и то же название процесса/регламента в разных встречах» — корректно дедуплицирует ≥80% случаев.

### Документация (Second Brain)

- [ ] Обновлены: [second-brain/01_projects/roles-and-permissions.md](../../second-brain/01_projects/roles-and-permissions.md) (или новый файл `roles-and-onboarding.md`), [second-brain/02_architecture/data-model.md](../../second-brain/02_architecture/data-model.md), [second-brain/02_architecture/module-map.md](../../second-brain/02_architecture/module-map.md).
- [ ] Созданы: `second-brain/01_projects/document-ingest.md`, `second-brain/01_projects/role-profile-agent.md`, `second-brain/01_projects/onboarding-wizard.md`, `second-brain/01_projects/company-framework-slots.md` (документация по слотам Б — Mission/Vision/Strategy/Process/Regulation/Policy/Tool/Metric/Decision, как они наполняются, как extraction работает).
- [ ] Обновлён `second-brain/02_architecture/code-pitfalls.md`: запись «Cypher только через `GraphService`».
- [ ] Обновлён `delivery/13-glossary.md` + `delivery/ui/copy-strings.ru.md` новыми терминами группы А (термины группы Б добавятся в Фазе γ).
- [ ] Запись рефлексии в `second-brain/05_история/2026-MM-DD-фаза-0-итог.md`.

---

## 8. Риски и ограничения

| Риск | Тяжесть | Смягчение |
|---|---|---|
| Команда не имеет опыта с Apache AGE / Cypher | средняя | Один человек становится «AGE owner», изучает Cypher и держит знания; остальная команда работает через API `GraphService`, не пишет Cypher напрямую. В `02_architecture/code-pitfalls.md` фиксируются типовые ошибки по мере накопления |
| Парсер PDF / DOCX даст плохое качество на отсканированных или сложных документах | средняя | На MVP — graceful degradation: если парсер не справился, `Document.status='failed'`, пользователь видит честную ошибку «не смогли распарсить, загрузите как Markdown или текст». OCR / Tika — следующая итерация |
| 10 реальных компаний с разной спецификой могут вскрыть кейсы, не учтённые в анализе | высокая | Онбордим первые 2–3 компании вручную, с разработчиком рядом; после стабилизации — оставшиеся 7 через wizard. Любая обнаруженная неточность анализа — обновление `plans/analysis/*` ДО фикса в коде |
| Расширение RBAC может сломать существующие политики и доступы | высокая | Все новые `ResourceType` добавляются с явными правилами в `policy.csv`; перед мержем — прогон по сценариям существующих ролей; security-review по skill `strict-production-review-gate` |
| `RoleProfileAgent` будет генерировать «мусорные» карты должности на малом объёме данных | средняя | В Фазе 0 фиксируем минимальный порог: если `IdeaBlock`-ов с пометкой `role_relevant` < N (например, 5) — карта остаётся в статусе «формируется»; LLM не вызывается, агент пропускает Role до накопления данных |
| AGE может оказаться непригоден для Yandex Managed PostgreSQL | средняя | Проверка — открытый вопрос №2 перед 0a; если managed не поддерживает, ставим self-hosted PostgreSQL на проде (один кластер, есть DevOps-опыт) |
| Wizard не входит в 15 минут (DoD-метрика) | низкая | Если на пилотах видим >15 минут — анализируем bottleneck (вероятно, ввод сотрудников); включаем CSV-импорт (открытый вопрос №4) |
| **Объём 0a существенно вырос** (≈16 моделей + ≈17 типов рёбер) — может растянуться на месяц-полтора | высокая | Стратегия дробления внутри 0a: фазы 0a.1 (модели группы А + AGE + GraphService), 0a.2 (модели группы Б + типы рёбер), 0a.3 (RBAC + API). После 0a.1 уже можно начинать 0b и 0c параллельно (на моделях группы А) — это снимает критический путь |
| **Extraction-LLM ошибается с типами сущностей группы Б** (Process vs Regulation vs Policy для одной упомянутой штуки) | высокая | (1) JSON-схема с обязательным `confidence` для каждого извлечённого типа; (2) низкая уверенность → сохраняем но в логи + флаг для ручной проверки; (3) `CuratorAgent` в Фазе δ собирает эти случаи в ленту вопросов. В Фазе 0 — просто копим, не блокируем; разбор — в γ |
| **Сущности группы Б накапливаются с шумом** — пользователь в Фазе γ открывает UI и видит сотни автогенерённых Process / Decision, среди которых много мусора | средняя | (1) Минимальный порог провенанса: сущность создаётся только если ≥2 независимых упоминания (для Process / Regulation / Policy) или явное упоминание решения (для Decision). (2) `EntityResolutionService` агрессивно дедуплицирует. (3) В UI Фазы γ — фильтр «уверенность ≥ X», по умолчанию скрывает шум |
| **Сложность extraction-промпта растёт** — JSON-схема с десятком новых типов перегружает LLM, падает качество | высокая | Открытый вопрос №8: разбивка на несколько проходов. На старте 0b — измеряем точность одного и нескольких проходов на 5–10 встречах; принимаем решение по данным. Если несколько проходов — растёт стоимость токенов; считаем экономику |
| **Срок Фазы 0 растягивается на 3+ месяца** | средняя | Сознательное смягчение: запускаем 0a.1 + 0c (мастер на видимых сущностях группы А) как **«ранний релиз»** для пилотов через 4–6 недель; группа Б и extraction для неё — доезжают следом без блокировки пилотов. Это компромисс между «сразу хорошо» и «время до первого реального клиента» |

---

## 9. Связь с roadmap'ом

Этот ТЗ закрывает **Фазу 0** обновлённого roadmap'а (раздел 6.5 анализа онтологии, итерации 14 и 15):

```
Фаза 0 (видимая часть: Role/Department/JobDescription/Skill/Document/RoleProfile + мастер + ЛК + RoleProfileAgent
        невидимая часть: каркас 5 уровней как пустые слоты — Mission/Vision/Strategy/Process/ProcessStep/
                          Regulation/Policy/Tool/Metric/Decision + extraction + entity resolution
        инфраструктура: Apache AGE + GraphService + EntityLink + полный набор типов рёбер)  ← мы здесь
→ Фаза α (bi-temporal layer на уже стоящем AGE)
→ Фаза β (ABAC на уровне фактов)
→ Фаза γ (UI для слотов группы Б: страницы и админка процессов/регламентов/политик/метрик/целей;
          динамическая онтология OntologyType; дельта Declared vs Observed)
→ Фаза δ (CuratorAgent + Inquiry + ChangeRequest)
→ Фаза ε (новые адаптеры ingest: Bitrix24, amoCRM, Jira/YouTrack/Tracker и т.д.)
→ Фаза ζ (специализированные агенты: ProcessNarrator, DecisionArchaeologist, AlignmentAgent, EmployeeClone, RoleClone)
→ Фаза η (query planner LLM + MCP-сервер)
```

**Ключевая особенность Фазы 0 после итерации 15:** к моменту Фазы γ в БД уже копятся данные правильной формы (Process/Regulation/Decision и т.д.). Фаза γ — это **добавление UI поверх существующих данных**, а не миграция данных и не создание новых форм.

**Ожидаемая длительность Фазы 0:** 2–3 месяца (с учётом расширения на каркас 5 уровней). При стратегии «ранний релиз» (см. риски §8): первый пилотный клиент — через 4–6 недель (на видимой части группы А); полная Фаза 0 — через 2–3 месяца.

---

## 10. Итог

_Заполняется по факту, когда все 4 sub-TZ закрыты._

- **Реализовано полностью / частично:** _TBD_
- **Что осталось:** _TBD_
- **Ссылка на рефлексию:** _TBD_
