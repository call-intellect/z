---
type: tz
feature: clone-construction-fixes
status: approved
date: 2026-07-03
owner_decision: "Вариант А — чиним ядро построения клонов СЕЙЧАС (провод + порог-крутилка + одиночная роль)"
relates_to:
  - plans/analysis/2026-07-03-clone-construction-fragility.md
  - plans/tz/2026-07-03-clone-stand-and-baseline.md
  - plans/2026-07-03-clone-stand-execution-journal.md
  - plans/analysis/2026-07-03-employee-clone-expert-answer-audit.md
supersedes_scope: "снимает из ТЗ-0 ограничение «поведение построения не трогаем» — по решению владельца"
---

# ТЗ — фикс построения клонов: провод назначения + порог склейки + одиночная роль

## 0. Зачем (одним абзацем)

Сейчас «создал должность → назначил человека → клон сразу собран» **не работает**: назначение из
кабинета не запускает сборку клона роли (сломанное событие), а даже при наличии корма черты почти не
рождаются — порог склейки reasoning-блоков захардкожен на `cosine ≥ 0.78` и режет ровно посередине облака
живых перефразировок (0.72–0.85). Плюс клон роли требует ≥2 носителей — одиночная должность (типовой SMB)
клон роли не получает вообще. Три точечных фикса закрывают всё три разрыва. Обоснование и данные —
[plans/analysis/2026-07-03-clone-construction-fragility.md](../analysis/2026-07-03-clone-construction-fragility.md).

## 1. Границы

**В scope:** Ф1 (провод `role.bearer_changed` из `PersonsService`), Ф2 (порог склейки → AdminSetting-крутилка
`knowledge.skillClusterSimilarityThreshold`, дефолт 0.72, в обоих кластеризаторах), Ф3
(`PERSONA_ROLE_AGG_MIN_PERSONS` → `getDynamic`, seed=1).

**НЕ в scope (уходит в ТЗ-1):** политика ответа клона (refusal-first → «эксперт всегда»), гейты ответа
`MIN_TRAITS_FOR_ANSWER`/`PERSONA_MIN_TRAITS`, `CLONE_V2_ENABLED`, видимая «заготовка клона» при создании
роли, переписывание алгоритма кластеризации (head-only greedy остаётся — трогаем только порог).

## 2. Фаза 1 — провод `role.bearer_changed` из PersonsService (Разрыв №1)

**Проблема:** авто-сборка клона роли слушает событие `role.bearer_changed`
([role-clone-persona-versioning.handler.ts:67](../../backend/src/modules/knowledge-core/services/role-clone-persona-versioning.handler.ts#L67)),
но эмитит его только `AppointmentsService.maybeEmitBearerChanged`
([appointments.service.ts:373](../../backend/src/modules/appointments/services/appointments.service.ts#L373)).
Кабинет назначает через `PersonsService`, который пишет `Appointment` напрямую
([persons.service.ts:328](../../backend/src/modules/persons/services/persons.service.ts#L328),
[:538](../../backend/src/modules/persons/services/persons.service.ts#L538)) и событие НЕ шлёт (в
конструкторе нет `EventEmitter2`).

**Контракт реализации:**
1. Внедрить `@Optional() @Inject(EventEmitter2) private readonly events?: EventEmitter2` в конструктор
   `PersonsService` (шаблон — `AppointmentsService`, [:37-39](../../backend/src/modules/appointments/services/appointments.service.ts#L37)).
   Импортировать тип `RoleBearerChangedEvent` из handler'а.
2. Добавить приватный `maybeEmitBearerChanged({ tenantId, roleId })` — **копия логики**
   `AppointmentsService.maybeEmitBearerChanged` ([:373-418](../../backend/src/modules/appointments/services/appointments.service.ts#L373)):
   читает активный `Appointment(validTo=null)` роли → `newBearerId`, читает активную
   `ExecutablePersona(scope='role')` → `oldBearerId`, при равенстве — `return`, иначе `emitAsync('role.bearer_changed', payload)`.
   Метод вызывается **после** commit транзакции (читает уже актуальное состояние БД).
3. Точки вызова (пост-commit, best-effort `void ... .catch`):
   - `create` ([:306-366](../../backend/src/modules/persons/services/persons.service.ts#L306)): после `$transaction`,
     если `args.body.roleId` задан → `maybeEmitBearerChanged({ tenantId, roleId: args.body.roleId })`.
   - `update` ([:407-563](../../backend/src/modules/persons/services/persons.service.ts#L407)): после `$transaction`,
     только при смене роли (`args.body.roleId !== undefined && args.body.roleId !== currentRoleId`) —
     эмит **для обеих** ролей: освобождённой `currentRoleId` (если была) и новой `args.body.roleId` (если задана).
     Освобождённая роль тоже пере-версионируется (носитель ушёл → клон приостанавливается).

**Инвариант:** идемпотентность обеспечивает handler (при равенстве носителя — skip), двойной эмит безопасен.

## 3. Фаза 2 — порог склейки блоков → крутилка (Разрыв №2, корень)

**Проблема:** `GROUP_SIMILARITY_THRESHOLD = 0.78` захардкожен в ДВУХ кластеризаторах:
- [specialist-3-7-skill.service.ts:59](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts#L59) (черты человека), использование [:603](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts#L603);
- [role-principle-synthesis.service.ts:23](../../backend/src/modules/knowledge-core/services/role-principle-synthesis.service.ts#L23) (принципы роли), использование [:515](../../backend/src/modules/knowledge-core/services/role-principle-synthesis.service.ts#L515).

Данные (58 живых блоков, синтетика): черт родилось 6, у Елены/Игоря — 0; косинусы садятся на 0.72–0.85, порог
0.78 режет посередине. Это «крутилка» по правилу №9 CLAUDE.md → в AdminSetting.

**Контракт реализации (единая крутилка на оба места — одна операция «склейка reasoning-блоков»):**
1. Ключ `knowledge.skillClusterSimilarityThreshold`, тип `UNIT_INTERVAL`, дефолт (code-fallback) **0.72**.
2. `specialist-3-7`: `groupBlocksBySimilarity(blocks)` → принять параметр `threshold: number`; в `rebuildProfile`
   рядом с `clusterMinObservations` ([:326](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts#L326))
   вычислить `const clusterThreshold = await this.cfg.getDynamic<number>('knowledge.skillClusterSimilarityThreshold', undefined, 0.72)`
   и передать. Удалить статик `GROUP_SIMILARITY_THRESHOLD` (больше не используется; `ARBITRATION_FLOOR=0.78` — отдельная сущность, НЕ трогать).
3. `role-principle-synthesis`: `groupBlocksBySimilarity<T>(blocks)` → принять `threshold: number`; в async-методе
   перед вызовом ([:144](../../backend/src/modules/knowledge-core/services/role-principle-synthesis.service.ts#L144))
   вычислить тот же `getDynamic` и передать. Удалить статик `GROUP_SIMILARITY_THRESHOLD`.
4. Реестр: строка `['knowledge.skillClusterSimilarityThreshold', UNIT_INTERVAL]` в
   [admin-setting-schema-registry.ts](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts) (рядом с `skillTraitSimilarityThreshold`).
5. FE-поле: в группу `skill` [KnowledgeCoreSettingsClient.tsx:219](../../frontend/app/(admin)/admin/ai/knowledge-core/KnowledgeCoreSettingsClient.tsx#L219)
   добавить `{ key: 'knowledge.skillClusterSimilarityThreshold', label: 'Порог склейки блоков в трейт', schema: ratio01(0.72), defaultValue: 0.72, description: ... }`.
6. Seed — см. Фаза 4.

**Калибровка:** 0.72 — стартовое значение по данным. Если повторный прогон стенда даёт у Елены/Игоря всё ещё 0
кластеров — итеративно снизить (0.70) или добавить крутилку `knowledge.skillClusterMinObservations` 3→2 (уже
getDynamic-ключ на [:326](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts#L326), без реестра). Решение — по факту прогона.

## 4. Фаза 3 — одиночная должность получает клон роли

**Проблема:** [executable-persona-build.service.ts:337](../../backend/src/modules/knowledge-core/services/executable-persona-build.service.ts#L337)
`if (activeProfiles.length < this.cfg.persona.roleAggMinPersons) return null;` — статичный ENV (=2).
Одиночная должность (1 носитель) клон роли не собирает. Ключ `knowledge.personaRoleAggMinPersons` УЖЕ в реестре
([:121](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts#L121)) и в FE
([KnowledgeCoreSettingsClient.tsx:265](../../frontend/app/(admin)/admin/ai/knowledge-core/KnowledgeCoreSettingsClient.tsx#L265)),
но потребитель читает статику.

**Контракт:**
1. Заменить на `const roleAggMin = await this.cfg.getDynamic<number>('knowledge.personaRoleAggMinPersons', 'PERSONA_ROLE_AGG_MIN_PERSONS', this.cfg.persona.roleAggMinPersons); if (activeProfiles.length < roleAggMin) return null;`
2. Seed значения **1** (см. Фаза 4). FE `defaultValue` 3→1 для консистентности.

## 4а. Фаза 5 — гейт сборки клона считает все слои метода, а не только skill (вскрыто прогоном)

**Проблема (данные стенда):** клон в промпт собирает 7 компонентов (skill/value/motivation/process_marker +
RolePrinciple + PracticeSkill + регламенты), НО гейт минимума `dedupedTraits.length < minTraits(3)` считает
**только слой `skill`** — в `buildForProfile` ([:123](../../backend/src/modules/knowledge-core/services/executable-persona-build.service.ts#L123)) и `buildForRole` ([:352](../../backend/src/modules/knowledge-core/services/executable-persona-build.service.ts#L352)).
На стенде: Дарья 2 skill + 3 value + 2 process = 7 черт, но роль-клон НЕ собрался (2<3); собрался только
Михаил (ровно 3 skill). Гейтим по 1 слою из 7 — несостыковка с тем, что в промпт идут все.

**Контракт:**
1. `personaMinTraits` — читать через `getDynamic('knowledge.personaMinTraits', 'PERSONA_MIN_TRAITS', this.cfg.persona.minTraits)` (ключ уже в реестре+FE, потребитель читал статику — тот же латентный баг, что roleAggMinPersons).
2. `buildForProfile`: убрать ранний skill-only гейт (:123); после загрузки слоёв (values/motivations/processMarkers)
   гейтить по `profile.traits.length + values.length + motivations.length + processMarkers.length < personaMinTraits`.
3. `buildForRole`: убрать skill-only гейт (:352); после загрузки слоёв гейтить по
   `dedupedTraits.length + values.length + motivations.length + processMarkers.length < personaMinTraits`.
4. Секции промпта НЕ трогаем (skill остаётся «черты подхода»). Меняется только условие «клон достаточно наполнен».
5. **Seed `knowledge.personaMinTraits=3`** (и FE default 5→3). Причина: админка была засеяна **5**, а потребитель
   читал ENV `PERSONA_MIN_TRAITS=3` МИМО админки → эффективный порог в проде всегда был 3. Перевод на getDynamic
   заставляет честно читать админку — без выравнивания это **подняло бы** порог 3→5 (регресс: меньше клонов).
   Сид=3 сохраняет фактическое поведение и делает крутилку честной.

**Открытая находка Слоя 0 (в baseline, НЕ в этом ТЗ):** почему skill-слой недопроизводится (у Дарьи 2 skill из
7 кластеров, хотя корм — метод) — мульти-детектор (skill/value/process на одном кластере). Разобрать в baseline.

## 4б. Фаза 6 — надёжность сборки клона (compile flash→pro + ретрай)

**Проблема (владелец: «1 из 5 упал — на 500 будет пачка»):** `executable-persona-compile` (сборка всей персоны из
7 слоёв) шёл primary на `deepseek-v4-flash`, который спотыкается на structured/thinking (`Thinking mode does not
support tool_choice`) → иногда падает в фолбэки. Локально (битые ключи фолбэков) → клон обнуляется; в проде →
тихая деградация на модель хуже. Клон — ключевой артефакт, собирать его на флейки-модели нельзя.

**Контракт:**
1. Маршруты `executable-persona-compile` **и** `skill-trait-verify` primary `deepseek-v4-flash` → **`deepseek-v4-pro`**
   (та же capable-модель, что у detect), secondary `gpt-5.4-mini`→`gpt-5.4` — в [seed-llm-task-routes-skill-and-clone.ts](../../backend/scripts/seed-llm-task-routes-skill-and-clone.ts) + обновить snapshot-спек. verify на flash падал в fail-open (черта промоутилась без проверки) — тот же корень.
2. **Прод-путь:** сид маршрутов НЕ в аггрегаторе; добавить `executable-persona-compile` и `skill-trait-verify` в TARGETS
   [patch-mass-migrate-to-deepseek-pro.ts](../../backend/scripts/patch-mass-migrate-to-deepseek-pro.ts) (в STEPS
   `--update-existing`, `everyDeploy`) — так primary→pro доедет на прод каждым деплоем, уважая admin-правки.
3. **Ретрай в сборке:** `compilePersonaPrompt` ([executable-persona-build.service.ts](../../backend/src/modules/knowledge-core/services/executable-persona-build.service.ts)) —
   цикл до 3 попыток на throw ИЛИ подозрительно короткий текст (<50 симв.), null только после всех попыток.
4. Проверка: build всех 5 person + 4 role клонов на стенде — 9/9 собираются стабильно (2+ прогона).

## 5. Фаза 4 — seed + деплой-регистрация

1. Новый `backend/scripts/seed-admin-setting-clone-construction.ts` (шаблон — `seed-admin-setting-knowledge-graph.ts`,
   `createPrismaClient()` из `_lib/prisma`), два SEEDS:
   - `knowledge.skillClusterSimilarityThreshold` = `0.72` (category `ai`, section `knowledge`, severity `high`).
   - `knowledge.personaRoleAggMinPersons` = `1` (category `ai`, section `knowledge`, severity `medium`).
   `upsertSetting` уважает admin-edited (не перетирает).
2. Зарегистрировать в `backend/scripts/apply-prod-deploy.ts` `STEPS` (phase `seed`).
3. Строка в `docs/operations/prod-deploy-log.md` Шаг 7.

## 6. Критерии приёмки

- [ ] `bun run typecheck` зелёный; `bun run lint` зелёный (без новых комментариев в коде — правило CLAUDE.md).
- [ ] Провод: после `PersonsService.update({roleId})` в логах есть `role.bearer_changed: создана новая версия
      клона роли` без ручного вызова handler'а.
- [ ] Порог: повторный прогон сид-стенда → у Елены и Игоря ≥1 черта каждому (было 0); суммарно черт заметно
      больше 6 (цель — ≥2 черты у ≥4 из 5 носителей).
- [ ] Одиночная роль: `buildForRole` для роли с 1 носителем возвращает не-null (клон роли собран).
- [ ] Крутилки читаются из AdminSetting (сид применён, `getDynamic` возвращает 0.72 / 1).
- [ ] FE-гвард `admin-setting-fe-keys.guard.spec.ts` зелёный (новый FE-ключ есть в реестре).

## 7. Верификация (после реализации)

1. `bun run typecheck && bun run lint` в `backend/` и `frontend/`.
2. Коммит в `work/2026-07-02` (push — только с явным подтверждением владельца).
3. Перезапустить dev-backend (подхват кода + регистрация listener'а), прогнать seed
   (`bun run scripts/seed-admin-setting-clone-construction.ts`).
4. Перепрогнать `seed-clone-feed.ts` (prepare→channelA→build→status) на STRELA_ORG, снять «стало».
5. Зафиксировать «было → стало» в журнале [plans/2026-07-03-clone-stand-execution-journal.md](../2026-07-03-clone-stand-execution-journal.md).

## 8. Итог

Реализовано: [ ] Ф1 · [ ] Ф2 · [ ] Ф3 · [ ] Ф4. Что осталось: —.
