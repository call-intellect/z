---
type: tz
status: implemented
date: 2026-05-25
implemented: 2026-05-25
owner: sergrv80@gmail.com
relates_to:
  - second-brain/01_projects/skill-and-clone.md
  - second-brain/01_projects/knowledge-clone.md
  - second-brain/01_projects/skill-trait-concepts.md
  - second-brain/02_architecture/knowledge-core.md
  - second-brain/05_история/2026-05-25-clone-reliability-hardening-wave.md
all-phases-closed: 2026-05-25
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 98%.**
> Все 6 фаз реализованы и подтверждены кодом (модели Prisma, сервисы, cron, бэкфиллы, admin API + UI, frontend-кнопки, seed моделей, golden-eval, snapshot-тесты). Единственные расхождения — косметические (незакрытый раздел
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# Усиление надёжности клона сотрудника

## Зачем

После анализа реализации SBA β-2 (профиль знаний) и SBA γ-1 (профиль навыков + клон) обнаружены конкретные слабые места, которые могут подорвать доверие к продукту:

1. Защита от «правдоподобной фальшивки от имени человека» держится на одной строке промпта (модель может её не послушать).
2. Названия категорий черт характера у разных людей не сводятся к общему — невозможна агрегация «у скольких людей в команде вот такая черта».
3. Уведомления об аномалиях профиля идут только администраторам организации, а не прямому руководителю сотрудника (поля «глава отдела» в схеме нет).
4. Поиск «кто разбирается в X» работает по совпадению слов в названии категории — не находит близкие по смыслу.
5. Описание клона («думай как X») обновляется раз в неделю — между сборками клон отвечает устаревшим стилем.
6. Главная модель критичного агента `skill-trait-detect` — `gpt-5.4` (`openai-via-proxy`). По решению владельца — переходим на DeepSeek V4 везде по умолчанию, а в админке должны быть видны и редактируемы **все** агенты.

ТЗ закрывает эти 6 пунктов.

## Принятые решения владельца (2026-05-25)

| # | Решение | Источник |
|---|---|---|
| Д1 | Жёсткое программное правило «минимум 2 рассуждения по теме вопроса» — до вызова языковой модели в ответе клона, а не как просьба к модели. | Согласован п.1 разбора |
| Д2 | Нормализация категорий — **автоматическая**, без участия человека. Агент по расписанию находит похожие категории, ведёт справочник «смысловых блоков», при создании новой черты сравнивает с справочником: если совпадает — берёт каноническое имя, иначе создаёт новый смысловой блок. | Согласован п.2 разбора |
| Д3 | Глава отдела добавляется отдельным полем в карточке отдела, уведомления об аномалиях идут ему в первую очередь, админам — только если главы нет. | Согласован п.3 разбора |
| Д4 | Поиск «кто разбирается в X» переходит на семантическую близость (отпечаток смысла), без полного отказа от текстового поиска как страховки. | Согласован п.4 разбора |
| Д5 | Модель по умолчанию для всех агентов клона — **DeepSeek V4** (`deepseek:deepseek-v4-pro` для критичных, `deepseek:deepseek-v4-flash` для остальных). Все агенты должны быть видны в админке с возможностью переключения модели для теста. | Согласован напрямую |
| Д6 | Снапшот-тест на промпт ответа клона + интеграционный тест отказа от ответа + золотой набор «отказных» кейсов. | Согласован п.6 разбора |
| Д7 | Триггер пересборки описания клона по событиям + кнопка «обновить клона сейчас» в UI. | Согласован п.7 разбора |

## Фазы реализации

### Фаза 1. Антифальшивка как программное правило, а не просьба

Цель: убрать зависимость антифальшивки от того, послушает ли модель промпт.

#### 1.1. Проверка плотности рассуждений по теме до вызова модели

- В [backend/src/modules/clones/services/clones.service.ts](backend/src/modules/clones/services/clones.service.ts) в `askPerson` и `askRole` добавить шаг между «retrieval подграфа» (шаг 5) и «вызов модели» (шаг 6):
  - посчитать семантическую близость вопроса к каждому из 20 рассуждений-блоков, загруженных в `loadPersonSubgraph` / `loadRoleSubgraph`;
  - выбрать те, у которых близость к вопросу не ниже `cfg.skill.cloneTopicSimilarityThreshold` (новая настройка, по умолчанию 0.70);
  - если таких блоков меньше `cfg.skill.cloneTopicMinBlocks` (новая настройка, по умолчанию 2) — **не вызывать модель**, вернуть готовый ответ-отказ из локали;
  - формулировка отказа должна быть та же самая, что в промпте `clone-respond.prompt.ts` пункт 6 — «У оригинала недостаточно высказываний по этой теме, чтобы я мог отвечать в его стиле без выдумывания. Спроси напрямую.».
- Регистрировать счётчик `clone_ask_refused_total{reason='topic_starved'}` в `BusinessMetricsService`.
- В `AskCloneResponseDto` добавить поле `refused: boolean` (опциональное, default false), `refusalReason: string | null`. Frontend на странице клона показывает этот ответ как «клон отказался отвечать» (визуально иначе, чем обычный ответ).

#### 1.2. Снапшот-тест промпта ответа клона

- Создать файл `backend/src/modules/knowledge-core/prompts/clone-respond.snapshot.spec.ts` по образцу [skill-trait-detect.snapshot.spec.ts](backend/src/modules/knowledge-core/prompts/skill-trait-detect.snapshot.spec.ts).
- Фиксируем: текст `CLONE_RESPOND_SYSTEM_PROMPT_BASE` и пример сборки `CLONE_RESPOND_USER_TEMPLATE` для трёх типичных входов.
- Снапшот должен ломаться при любом изменении формулировок пунктов 1–7 системного промпта.

#### 1.3. Интеграционный тест отказа

- Создать `backend/test/integration/clones-refusal.spec.ts`.
- Сценарии:
  - на вход вопрос «как ты будешь продавать наш продукт?» + контекст из 5 рассуждений сотрудника, **ни одно** из которых не про продажи — ожидается `refused=true`, фраза-отказ;
  - на вход вопрос, который реально подкреплён 3+ рассуждениями — ожидается обычный ответ с цитатами;
  - на вход вопрос с одним рассуждением «на грани» — ожидается `refused=true` (порог 2 — строгое неравенство).
- Тест должен быть на реальной БД (через тот же контур, что и существующие integration-тесты), модель — замокана.

#### 1.4. Метрики

- `clone_ask_refused_total{reason}` (counter), reason ∈ `topic_starved` (этот шаг) + задел на будущие причины.
- На дашборде Прометея/Графаны добавить панель «доля отказов клона» (поле в follow-up задаче на observability).

**DoD фазы 1:**
- [ ] В коде `ClonesService.askPerson` и `askRole` есть проверка плотности до вызова модели.
- [ ] Снапшот-тест `clone-respond.snapshot.spec.ts` зелёный.
- [ ] Интеграционный тест `clones-refusal.spec.ts` зелёный (3 сценария).
- [ ] Метрика `clone_ask_refused_total` появляется в `/metrics`.
- [ ] DTO ответа клона расширен полями `refused` и `refusalReason`.

---

### Фаза 2. Автоматическая нормализация категорий черт («смысловые блоки»)

Цель: чтобы «осторожен с ранними оценками сроков», «не любит давать сроки без данных» и «откладывает оценку до сбора фактов» считались одной и той же чертой компании.

#### 2.1. Модель данных

Новая таблица `SkillTraitConcept` в [backend/prisma/schema.prisma](backend/prisma/schema.prisma):

```prisma
model SkillTraitConcept {
  id              String   @id @default(cuid())
  tenantId        String   // изоляция по организации
  canonicalName   String   // каноническое имя смыслового блока, например «осторожен с ранними оценками сроков»
  description     String?  // 1-2 предложения, поясняющие смысл, для админки
  variants        String[] // массив наблюдённых вариаций названия (для прозрачности)
  embedding       Unsupported("vector(1536)")?
  status          SkillTraitConceptStatus @default(active)
  // active — используется при нормализации
  // merged_into — слит в другой концепт, в processingNotes указано куда
  // archived — больше не появляется в новых traits

  mergedIntoId    String?
  mergedInto      SkillTraitConcept? @relation("conceptMerge", fields: [mergedIntoId], references: [id])
  mergedFrom      SkillTraitConcept[] @relation("conceptMerge")

  traitCount      Int      @default(0) // денормализованный счётчик активных traits, ссылающихся на концепт
  firstSeenAt     DateTime @default(now())
  lastSeenAt      DateTime @default(now())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  org             Org @relation(fields: [tenantId], references: [id])
  traits          SkillTrait[]

  @@unique([tenantId, canonicalName])
  @@index([tenantId, status])
  @@map("skill_trait_concepts")
}

enum SkillTraitConceptStatus {
  active
  merged_into
  archived
}
```

В `SkillTrait` добавить:

```prisma
model SkillTrait {
  // ... существующие поля
  conceptId       String?
  concept         SkillTraitConcept? @relation(fields: [conceptId], references: [id])
  // ...
  @@index([conceptId])
}
```

После правки — `bun run prisma:push` (не `migrate`, см. [skill `prisma-db-push-rules`](.claude/skills/prisma-db-push-rules)). Индекс HNSW на `skill_trait_concepts.embedding` добавляется через `scripts/apply-postgres-init.ts` (аналогично существующим).

#### 2.2. Сервис нормализации

Новый файл `backend/src/modules/knowledge-core/services/skill-trait-concept.service.ts`:

- `findOrCreateConcept(tenantId, category, statement) → SkillTraitConcept` — основная точка входа. Логика:
  1. Посчитать семантический отпечаток текста `category. statement` (через существующий `KnowledgeEmbeddingService`).
  2. Найти `top-1` концепт того же `tenantId` со статусом `active` по векторной близости.
  3. Если близость ≥ `cfg.skill.conceptMatchThreshold` (новая настройка, по умолчанию 0.85) — вернуть найденный концепт, добавить `category` в `variants` (если ещё нет), обновить `lastSeenAt` и `traitCount`.
  4. Иначе — создать новый концепт: `canonicalName = category` (как пришло от языковой модели), `embedding` посчитан, `variants = [category]`.
- `recomputeConceptForTrait(traitId)` — для бэкфилла и ручной правки.
- `mergeConcepts(sourceId, targetId)` — для cron-а нормализации.

Сервис вызывается из `Specialist37Service.createNewTraitRaw` (и `mergeIntoExisting`, если меняется category) **синхронно** в той же транзакции, что и запись черты.

#### 2.3. Cron-нормализатор «второго прохода»

Новый файл `backend/src/modules/knowledge-core/workers/skill-trait-concept-normalizer.cron.ts`:

- Расписание: `0 4 * * *` (раз в сутки в 04:00 по серверному времени) — после `SkillProfileRecalibrateCron` (`0 5 * * *`), чтобы decay уже отработал.

  Стоп: точное время — `0 3 * * *` (за час до decay), чтобы нормализация попала в decay этого же дня.

- Работает по одной организации за раз:
  1. Берёт все активные концепты.
  2. Кластеризует их по векторной близости методом union-find с порогом `cfg.skill.conceptMergeThreshold` (новая настройка, по умолчанию 0.92 — выше порога создания, чтобы случайные дрейфы не сливали разные концепты).
  3. Для каждого кластера из 2+ концептов:
     - выбирает «опорный» концепт — тот, у кого `traitCount` максимальный;
     - остальные помечает `status='merged_into'`, проставляет `mergedIntoId`;
     - перепривязывает `SkillTrait.conceptId` всех traits слитых концептов на опорный;
     - объединяет `variants[]`.
  4. Архивирует концепты без активных traits старше 6 месяцев (`status='archived'`).
  5. Метрики: `skill_trait_concepts_total{status}` (gauge), `skill_trait_concepts_merged_total` (counter).

- Идемпотентность: cron гоняется на единичном Redis-замке per-tenant с TTL 1 час.

#### 2.4. Бэкфилл существующих traits

Скрипт `backend/scripts/skill-trait-concepts-backfill.ts` (см. [skill `safe-seed-rules`](.claude/skills/safe-seed-rules) — это one-off patch, не sync):

- Для каждой организации:
  - идёт по всем активным `SkillTrait` без `conceptId`;
  - вызывает `findOrCreateConcept`;
  - проставляет `conceptId`;
  - после первого прохода — запускает cron-нормализатор вручную (один раз), чтобы слить накопившиеся дубли.
- Запуск: `bun run scripts/skill-trait-concepts-backfill.ts`.
- Idempotent: повторный запуск ничего не ломает.

#### 2.5. API чтения для админки

Новый контроллер `backend/src/modules/admin/skill-trait-concepts/`:

- `GET /api/v1/admin/skill-trait-concepts?status=active|merged_into|archived&page=1&pageSize=50` — список концептов с `traitCount`, `variants`, `lastSeenAt`. Доступно только `owner`/`admin`.
- `GET /api/v1/admin/skill-trait-concepts/:id` — детали + список последних 20 traits, ссылающихся на этот концепт.
- `POST /api/v1/admin/skill-trait-concepts/:id/merge` — ручное слияние двух концептов (страховка на случай, если автомат пропустил). Body: `{ targetId: string, reason: string }`.
- `POST /api/v1/admin/skill-trait-concepts/:id/archive` — ручная архивация. Body: `{ reason: string }`.

DTO — через `nestjs-zod`, Swagger — обязательно (см. [skill `nestjs-rules`](.claude/skills/nestjs-rules)).

#### 2.6. UI в админке

Новая страница [frontend/app/(authenticated)/admin/skill-trait-concepts/page.tsx](frontend/app/(authenticated)/admin/skill-trait-concepts/page.tsx):

- Master-detail: слева список концептов (поиск + фильтр статуса), справа карточка с вариациями и списком последних traits.
- Действия: «Слить с другим концептом» (модалка с поиском концепта-цели и обязательным обоснованием), «Архивировать».
- Только админ/владелец организации.
- Тексты — на русском (см. [feedback `admin_ui_russian_only`](C:\Users\USER\.claude\projects\c--work-z\memory\feedback_admin_ui_russian_only.md)). Терминология: «Смысловой блок навыка», не «концепт».

#### 2.7. Probe-event на конфликт концептов

В `SkillTraitConceptNormalizerCron` после слияния:

- если в слитом кластере оказались концепты с **разными** `canonicalName` и совокупно ≥ 5 traits — отправить probe-event главе отдела (или админам, см. фазу 3) типа `skill.concepts_merged` с предложением проверить каноническое имя.

**DoD фазы 2:**
- [ ] Модель `SkillTraitConcept` + поле `SkillTrait.conceptId` применены через `prisma:push`.
- [ ] HNSW индекс на `skill_trait_concepts.embedding` добавлен в `apply-postgres-init.ts`.
- [ ] Сервис `SkillTraitConceptService` готов, юнит-тесты на `findOrCreateConcept` (≥3 случая: точное совпадение, близкое совпадение, новый концепт).
- [ ] Cron-нормализатор работает, юнит-тест на кластеризацию.
- [ ] Бэкфилл прошёл на dev и проверен — все существующие traits получили `conceptId`.
- [ ] 4 эндпойнта административного API + Swagger.
- [ ] UI-страница `/admin/skill-trait-concepts` — master-detail работает.
- [ ] Метрики `skill_trait_concepts_total` и `skill_trait_concepts_merged_total` появляются в `/metrics`.

---

### Фаза 3. Глава отдела + переадресация уведомлений ему

#### 3.1. Модель данных

В `Department` в [backend/prisma/schema.prisma](backend/prisma/schema.prisma):

```prisma
model Department {
  // ... существующие поля
  headPersonId   String?
  headPerson     Person? @relation("departmentHead", fields: [headPersonId], references: [id])
}
```

В `Person`:

```prisma
model Person {
  // ... существующие поля
  headOfDepartments Department[] @relation("departmentHead")
}
```

После — `bun run prisma:push`.

#### 3.2. API для назначения главы

В существующем модуле `departments` (или там, где уже редактируются отделы):

- `PATCH /api/v1/departments/:id/head` — body: `{ headPersonId: string | null }`. Доступ — `owner`/`admin`.
- Валидация: `headPersonId` должен принадлежать той же организации, у него `relationship='employee'`, `deletedAt=null`.

#### 3.3. UI

На существующей странице админки отдела (frontend) — добавить блок «Глава отдела» с селектором сотрудника. Должен быть очищаемым (вариант «не назначен»).

#### 3.4. Переадресация уведомлений

В `Specialist37ProbeService` и `Specialist32ProbeService` (см. [knowledge-clone.md](second-brain/01_projects/knowledge-clone.md) — там сейчас явно отложено) — переписать функцию выбора получателя:

```
recipient =
  Person.primaryDepartment.headPerson  (если есть и не сам субъект-носитель)
  ?: org admins (как сейчас)
```

Если глава отдела совпадает с тем, про кого probe — fallback к админам (нельзя слать человеку probe про него самого).

#### 3.5. Тесты

- Юнит-тест на выбор получателя: глава есть + не совпадает с субъектом → возвращает главу.
- Юнит-тест: глава совпадает с субъектом → fallback к админам.
- Юнит-тест: главы нет → fallback к админам.

**DoD фазы 3:**
- [ ] Поле `Department.headPersonId` применено.
- [ ] Эндпойнт назначения главы + UI на странице отдела.
- [ ] Получатель probe в Specialist37 и Specialist32 — глава отдела при наличии.
- [ ] 3 юнит-теста проходят.

---

### Фаза 4. Поиск «кто разбирается в X» по смыслу

#### 4.1. Семантический отпечаток для категорий профиля знаний

Сейчас `Person.knowledgeProfile` — это JSON. Перевод на отдельную таблицу — большая работа, не сейчас. Минимально безопасное изменение:

- Добавить новую таблицу `PersonKnowledgeCategoryEmbedding` (тонкий индекс, не дубль данных):

```prisma
model PersonKnowledgeCategoryEmbedding {
  id           String   @id @default(cuid())
  tenantId     String
  personId     String
  categoryName String   // = knowledgeProfile.categories[].name
  confidence   String   // 'low' | 'medium' | 'high' — копия для фильтрации без чтения JSON
  embedding    Unsupported("vector(1536)")?
  builtAt      DateTime @default(now())
  profileBuildVersion Int // = Person.profileBuildVersion на момент построения

  person       Person @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@index([tenantId, confidence])
  @@index([personId])
  @@map("person_knowledge_category_embeddings")
}
```

- HNSW-индекс на `embedding` — в `apply-postgres-init.ts`.
- `KnowledgeCloneRebuildWorker` после записи `Person.knowledgeProfile` — в той же транзакции:
  1. Удалить все `PersonKnowledgeCategoryEmbedding` этого `personId`.
  2. Для каждой категории нового профиля посчитать отпечаток `KnowledgeEmbeddingService.embedQuery(category.name + ' ' + sampleStatement)`.
  3. Записать новые строки.

#### 4.2. Переписать `Specialist32CardHandler` на векторный поиск

В [backend/src/modules/knowledge-core/services/specialist-3-2-card-handler.service.ts](backend/src/modules/knowledge-core/services/specialist-3-2-card-handler.service.ts):

- Новый код `getCardsForQuery`:
  1. Посчитать отпечаток вопроса.
  2. SQL-запрос к `person_knowledge_category_embeddings` с фильтром по `tenantId`, JOIN на `Person` с `relationship='employee'`, `deletedAt=null`, сортировка по векторной близости, лимит = `limit * 3` (запас, потому что у одного человека может быть несколько релевантных категорий).
  3. Группировка по `personId`, агрегация score (сумма обратных дистанций, взвешенных по confidence).
  4. Top `limit` людей.
  5. Текст ответа — собирается из 2–3 топ-категорий найденного человека через чтение JSON (как сейчас).
- **Fallback**: если у организации меньше 5 записей в `person_knowledge_category_embeddings` (т.е. бэкфилл ещё не прошёл) — использовать существующий substring-поиск как сейчас.

#### 4.3. Бэкфилл

Скрипт `backend/scripts/person-knowledge-embeddings-backfill.ts`:
- Для каждой организации, для каждого `Person.knowledgeProfile` — пересчитать категории-отпечатки.
- Idempotent: можно гонять повторно.

#### 4.4. Тесты

- Юнит-тест: запрос «кто знает Stripe» матчит Person с категорией «биллинг и платёжные шлюзы» (если в семантической базе они близки). Замокать `KnowledgeEmbeddingService` с детерминированными векторами.

**DoD фазы 4:**
- [ ] Таблица `PersonKnowledgeCategoryEmbedding` применена, HNSW-индекс есть.
- [ ] `KnowledgeCloneRebuildWorker` обновляет таблицу при пересборке профиля знаний.
- [ ] `Specialist32CardHandler.getCardsForQuery` переписан на векторный поиск с fallback.
- [ ] Бэкфилл выполнен.
- [ ] Юнит-тест семантического поиска зелёный.

---

### Фаза 5. Реактивная пересборка описания клона

#### 5.1. Снижение порогов триггера + перенос в настройки

В [backend/src/modules/knowledge-core/workers/executable-persona-trigger-watcher.cron.ts](backend/src/modules/knowledge-core/workers/executable-persona-trigger-watcher.cron.ts):

- Существующие пороги (сейчас они хардкод/частично в конфиге) перенести в `TypedConfigService.skill`:
  - `personaRebuildTraitDeltaThreshold` — сколько новых или замещённых черт должно появиться, чтобы запустить пересборку. По умолчанию **2** (сейчас фактически выше).
  - `personaRebuildMaxAgeHours` — максимальный возраст активного описания, после которого пересборка запускается даже без новых черт. По умолчанию **48** часов.
- Cron бегает чаще — `0 */2 * * *` (раз в 2 часа), но реально пересобирает только тех, у кого выполнен один из триггеров.

#### 5.2. Кнопка «Обновить клона сейчас» в UI

- В `frontend/app/(authenticated)/me/clone/page.tsx` (страница уже существует, см. [skill-and-clone.md](second-brain/01_projects/skill-and-clone.md)) — добавить кнопку «Обновить клона» в заголовок.
- Под кнопкой — подсказка «Последнее обновление: {дата} • если ваш стиль работы недавно изменился, нажмите чтобы пересобрать».
- При нажатии — вызов уже существующего эндпойнта `POST /api/v1/clones/persons/:id/persona-snapshot/rebuild` (см. `ClonesService.triggerManualPersonaSnapshot`).
- Disabled на 60 секунд после успешного нажатия (визуальный feedback + защита от спама).
- Сообщение об успехе на русском: «Клон обновляется. Это займёт около минуты».

То же самое на странице `/persons/[id]/skill-profile` — только для тех, у кого `canMarkMisleading=true` (admin/owner/direct manager).

#### 5.3. Кнопка в чате клона

В UI чата клона (там, где идёт диалог) — компактная иконка «обновить» в шапке диалога. При нажатии — тот же эндпойнт + предупреждение «Текущий ответ был сгенерирован по описанию от {дата}. После обновления следующие ответы будут учитывать самые новые наблюдения.».

#### 5.4. Тесты

- Юнит-тест cron'а: при `traitDelta >= 2` — задача rebuild ставится в очередь; при `age >= 48h` — тоже; при отсутствии обоих условий — нет.
- E2E-тест кнопки: нажатие → запрос ушёл → disabled на 60 секунд.

**DoD фазы 5:**
- [ ] Пороги триггера вынесены в `TypedConfigService.skill` с дефолтами 2 / 48 часов.
- [ ] Cron-watcher бегает раз в 2 часа.
- [ ] Кнопка «Обновить клона» работает на `/me/clone` и `/persons/[id]/skill-profile`.
- [ ] Иконка «обновить» в чате клона работает.
- [ ] 2 теста (юнит + E2E) зелёные.

---

### Фаза 6. DeepSeek V4 везде по умолчанию + полная видимость агентов в админке

#### 6.1. Переключение моделей в LlmTaskRoute

В [backend/prisma/seed-llm-routes.ts](backend/prisma/seed-llm-routes.ts) (или соответствующем seed-файле — см. [skill `z-ai-agent-rules`](.claude/skills/z-ai-agent-rules) про прайс-карту и admin-editable):

Для всех агентов клона выставить:
- `primary: 'deepseek:deepseek-v4-pro'` для критичных (`skill-trait-detect`)
- `primary: 'deepseek:deepseek-v4-flash'` для остальных (`skill-trait-merge`, `executable-persona-compile`, `clone-respond`, `knowledge-clone-extract`, `knowledge-clone-merge`)
- `secondary: 'openai-via-proxy:gpt-5.4-mini'`
- `tertiary: 'ollama:qwen3:30b'`

**Открытый вопрос Д5а** (требует подтверждения владельца до выполнения):

> `skill-trait-detect` — критичный агент, формулировки которого определяют доверие к продукту. Переключение primary с `gpt-5.4` на `deepseek-v4-pro` рискует ухудшить стиль формулировок. Предложение:
> 1. Сначала собрать «золотой набор» из 20 реальных кейсов (см. ниже п.6.4).
> 2. Прогнать обе модели на нём в режиме сравнения.
> 3. Если DeepSeek V4 Pro даёт качество не хуже — переключить.
> 4. Если хуже — оставить `gpt-5.4` именно для этого агента, остальных перевести.

Patch-script: `backend/scripts/llm-routes-clone-agents-deepseek-v4.ts` (см. [skill `safe-seed-rules`](.claude/skills/safe-seed-rules) — это one-off patch, не sync). Должен:
- проверять, что route не помечен `adminEdited=true` (тогда не трогать);
- обновлять provider/model;
- логировать каждое изменение.

#### 6.2. Полная видимость всех агентов в админке

Проверить: на странице `/admin/llm/routes` (или как она у нас называется — см. реестр в [01_projects/ai-jobs.md](second-brain/01_projects/ai-jobs.md)):

- В списке агентов **видны** все 6 агентов клона + новые из этого ТЗ (см. 6.3).
- У каждого видна цепочка primary/secondary/tertiary.
- Можно переключить модель через select + сохранить.
- При сохранении — флаг `adminEdited=true`, чтобы seed-скрипты не перетёрли.
- Есть кнопка «Тест агента» — отправляет фиксированный пробный input и показывает выход + latency + cost.

Если кнопки «Тест агента» нет — это **отдельная подфаза**, написать её под этой же фазой 6.

#### 6.3. Регистрация новых агентов в админке

Из этого ТЗ появляются новые `taskType`:

| `taskType` | Назначение | Модель primary |
|---|---|---|
| `skill-trait-concept-name` (опц.) | Если решим, что каноническое имя смыслового блока надо генерировать языковой моделью (а не брать category «как есть» от первого trait'а) — отдельный лёгкий агент. | `deepseek-v4-flash` |

Регистрация — через seed + строка в админке.

Решение по необходимости `skill-trait-concept-name` — открытый вопрос (см. ниже).

#### 6.4. «Золотой набор» для определителя черт

- Файл `backend/test/eval/skill-trait-detect-golden.spec.ts` (рядом с существующими eval, см. [backend/test/eval/](backend/test/eval/)).
- 20 фикстур: набор цитат + ожидаемые свойства результата (не точная строка, а проверки):
  - содержит ли формулировка qualifier («похоже»/«склонен»/«в большинстве случаев»/«часто»);
  - длина 10..2000 символов;
  - category длина 3..200;
  - есть ли в формулировке поведенческий глагол (не «грамотный»/«ответственный»);
  - адекватность confidence (если 6+ наблюдений с разных дат — должно быть `high`).
- 5 «отказных» кейсов: цитаты без рассуждения → ожидается пустой `sourceBlockIds`.
- Запуск: `bun run test:eval` (отдельная команда, не на CI — дорого, гоняется вручную или раз в неделю по расписанию).
- Snapshot пройденности: «18/20 — зелёное».

#### 6.5. Заморозка версии модели для критичного агента

В seed routes для `skill-trait-detect` указывать **версионированный** slug, а не семейство:

- сейчас: `deepseek:deepseek-v4-pro` или `openai-via-proxy:gpt-5.4`
- становится: `deepseek:deepseek-v4-pro@2026-04-15` (если провайдер поддерживает версионные slug-и; иначе — pin через провайдерскую настройку и явный комментарий в seed).

Если поставщик не поддерживает версионные slug-и — добавить в админке поле «закреплённая версия» с явным предупреждением «не обновлять без прогона golden-набора».

**DoD фазы 6:**
- [ ] Все 6 существующих агентов клона переведены на DeepSeek V4 (с оговоркой по `skill-trait-detect` — после подтверждения владельца).
- [ ] Patch-script `llm-routes-clone-agents-deepseek-v4.ts` написан и прошёл на dev.
- [ ] На `/admin/llm/routes` видны все агенты + переключение модели работает.
- [ ] Кнопка «Тест агента» на странице админки работает (если отсутствовала — добавлена).
- [ ] Золотой набор `skill-trait-detect-golden.spec.ts` собран (20 кейсов + 5 отказных).
- [ ] Версия модели критичного агента — закреплена явно или через UI-поле.

---

## Закрытые открытые вопросы (зафиксированы 2026-05-25)

| # | Решение | Обоснование |
|---|---|---|
| ОВ1 | Переключаем `skill-trait-detect` с `gpt-5.4` на `deepseek-v4-pro` **после прогона golden-набора и согласия владельца по факту**. | Подтверждено владельцем 2026-05-25. |
| ОВ2 | Порог создания нового смыслового блока — **0.85** (`cfg.skill.conceptMatchThreshold`). Порог слияния в cron-нормализаторе — **0.92** (`cfg.skill.conceptMergeThreshold`). Второй выше, потому что слияние деструктивно и должно быть очень уверенным. | Решение оркестратора (2026-05-25). |
| ОВ3 | **Вводим** агент `skill-trait-concept-name` (DeepSeek V4 Flash). Но он вызывается **только в cron-нормализаторе** при слиянии 2+ концептов в один кластер — переименовывает результат в красивое каноническое имя. При создании одиночной черты — берём `category` как есть (экономим вызовы модели). | Решение оркестратора (2026-05-25). |
| ОВ4 | Терминология в UI: **«Смысловой блок навыка»** (как сформулировал владелец в обсуждении). В админке раздел называется «Смысловые блоки», в API внутреннее имя — `SkillTraitConcept`. | Решение оркестратора (2026-05-25). |
| ОВ5 | Прокси DeepSeek версионные slug-и **не поддерживает**. Заморозка реализована через: (1) новое поле `LlmTaskRoute.pinnedVersionNote String?` — текстовая пометка о закреплённой версии; (2) snapshot-тест на seed `skill-trait-detect` ([backend/scripts/seed-llm-task-routes-skill-and-clone.snapshot.spec.ts](backend/scripts/seed-llm-task-routes-skill-and-clone.snapshot.spec.ts)) — ломается при любом изменении model/provider; (3) предупреждение в UI `/admin/llm/routes` «модель не закреплена по версии». | Решение оркестратора (2026-05-25) на основе [docs/reference/llm-models-playbook.md](docs/reference/llm-models-playbook.md). |

## Порядок выполнения

Фазы можно гнать частично параллельно, но порядок зависимостей такой:

```
Фаза 1 (антифальшивка)  ─┐
                         ├─→ можно ставить независимо
Фаза 3 (глава отдела)    ─┤
                         │
Фаза 2 (смысловые блоки) ─┼─→ Фаза 4 опирается на embedding-инфраструктуру,
                         │                       можно делать после фазы 2.1-2.2
Фаза 4 (семантич. поиск) ─┘

Фаза 5 (триггер пересборки) — независимая, можно делать любым приоритетом.

Фаза 6 (модели + админка) — последняя:
   зависит от золотого набора, который проще собрать когда фазы 1-2 уже катятся в стейдже.
```

Рекомендованная последовательность для одного разработчика:

1. **Неделя 1.** Фаза 1 + Фаза 3 (короткие и снимают самые опасные риски).
2. **Неделя 2.** Фаза 2 (модель + сервис + cron + бэкфилл; UI и админ-API в конец).
3. **Неделя 3.** Фаза 4 (опирается на embedding-сервис, отлаженный в фазе 2) + Фаза 5 (UI-добавки).
4. **Неделя 4.** Фаза 6: золотой набор + переключение моделей + проверка админки.

Итого — около месяца силами одного разработчика, или 2 недели вдвоём (фазы 1+3 и фазы 2+4 параллельно).

## Итог

Реализовано: пока ничего, статус — `draft`.

Что нужно сделать до старта работы:
- [ ] Закрыть открытые вопросы ОВ1–ОВ5.
- [ ] Создать рефлексию о факте появления этого ТЗ в `second-brain/05_история/`.
- [ ] Добавить ссылку на этот файл в `second-brain/index.md`.

После завершения всех 6 фаз:
- [ ] Обновить `second-brain/01_projects/skill-and-clone.md` — снять упоминания «отложено».
- [ ] Обновить `second-brain/01_projects/knowledge-clone.md` — пометить probe→manager и embedding-search как реализованные.
- [ ] Обновить `second-brain/02_architecture/data-model.md` — добавить `SkillTraitConcept`, `PersonKnowledgeCategoryEmbedding`, `Department.headPersonId`.
- [ ] Закрыть статус ТЗ как `implemented`.
