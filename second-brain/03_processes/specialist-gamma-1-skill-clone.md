---
name: specialist-gamma-1-skill-clone
title: Клон должности — SkillProfile + ExecutablePersona + Clone API
trigger_type: event
status_overall: partial
last_audited: 2026-05-29
owners_human:
  - продакт «второго мозга»
  - инженер knowledge-core
  - инженер clones
related_plans:
  - plans/archive/2026-05-21-second-brain-agents-umbrella.md
  - plans/archive/2026-05-23-sba-gamma-1-finishing-skilltraitcategory-persona-versioning.md
  - plans/archive/2026-05-25-clone-reliability-hardening.md
  - plans/archive/2026-05-25-llm-architecture-changes-from-experiments.md
  - plans/archive/2026-05-26-clone-access-grant-admin-api.md
  - plans/archive/2026-05-26-clones-marketplace-frontend.md
related_projects:
  - 01_projects/skill-and-clone.md
  - 01_projects/skill-trait-concepts.md
  - 01_projects/probe-agent.md
---

# Клон должности (SkillProfile + ExecutablePersona)

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

В каждой компании есть знание, которое уходит вместе с человеком. Маркетолог принимает решения определённым образом, продакт пишет ТЗ в своей манере, разработчик закладывает архитектуру по своим принципам. Когда сотрудник уходит, это знание теряется — даже если он что-то задокументировал. Z делает это знание долговечным.

Z наблюдает, как носители каждой должности рассуждают на встречах: «почему я так решил», «на каком основании», «почему именно этот вариант». Из таких объяснений платформа постепенно собирает «навыковый профиль» — список черт подхода к работе. Профиль строится не на личных данных, а на наблюдаемом поведении. Через какое-то время у каждой должности накапливается достаточно черт, чтобы из них собрать «клон должности» — рабочий артефакт, с которым может общаться любой сотрудник: «как маркетолог нашей компании решил бы вот эту задачу?», «как продакт у нас сформулировал бы ТЗ?».

Важно: клон сделан **по должности**, не по человеку. Один клон Маркетолога живёт компании дольше, чем конкретный носитель — когда меняется человек, к клону прибавляется новая версия с поправкой на наблюдения. Личный «клон сотрудника» не показывается публично — только специальный admin может выдать персональный доступ.

Защита от халтуры встроена в три места: 1) до похода в LLM программное правило проверяет, что в наблюдаемой базе вообще есть ≥ 2 реплики этого носителя по теме вопроса — иначе клон отказывается отвечать; 2) каждая черта формулируется гипотезно (`похоже`, `склонен`, `в большинстве случаев`) — никакого приговора; 3) у каждого ответа клона висит дисклеймер «(клон; могу ошибаться)». Если черта выглядит неправдой, прямой руководитель может пометить её «misleading» — после этого она не учитывается, и при наборе порога severity-critical клон пересобирается внеочередно.

## 2. Что запускает (триггер)

- **Тип:** событие (новый блок reasoning) + расписание (decay / snapshots / digest) + пользовательский ASK.
- **Что инициирует:**
  1. В графе появился `IdeaBlockEntity.role='subject'` для Person с `relationship='employee'` и блок имеет `signalType ∈ {reasoning, rationale, decision_basis}` — RouterService dispatch в `core.specialist-routing` jobName=`3-7-skill`, оттуда worker дёргает `enqueueRebuildSkillProfile(debounce 60s)` в очередь `core.skill-profile-rebuild`.
  2. Каждые сутки `0 5 * * *` — `SkillProfileRecalibrateCron` (decay traits).
  3. Каждые 2 часа `0 */2 * * *` — `ExecutablePersonaTriggerWatcherCron` (реактивный rebuild персоны по delta ≥ 2 traits за 24ч ИЛИ возраст snapshot > 48ч).
  4. Каждое воскресенье `0 6 * * SUN` — `ExecutablePersonaBuildCron` (weekly snapshots scope='person' + scope='role').
  5. Каждый понедельник `0 9 * * MON` — `SkillManagerDigestCron` (рассылка дайджеста manager'ам).
  6. Каждые сутки `0 3 * * *` — `SkillTraitConceptNormalizerCron` (слияние смысловых концептов).
  7. REST `POST /api/v1/clones/persons/:id/ask` или `/roles/:id/ask` — пользовательский ASK с rate-limit 20/сутки.
- **Технический источник:** очередь `core.skill-profile-rebuild`, очередь `core.specialist-routing` (jobName=`3-7-skill`), 5 cron'ов в `knowledge-core/workers/`, REST в `clones.controller.ts`.

## 3. Шаги процесса (общий список)

1. **На встрече или в заметке сотрудник объяснил, почему он что-то сделал** — конвейер графа знаний пометил блок как reasoning/rationale/decision_basis и идентифицировал сотрудника как subject.
2. **Платформа диспетчит блок в специалиста 3-7** — он находит/создаёт `SkillProfile` сотрудника и ставит «пересобрать профиль через минуту» (debounce 60s, чтобы серия блоков слилась в один rebuild).
3. **Rebuild профиля** — KNN-группировка reasoning-блоков по похожести → LLM `skill-trait-detect` (primary DeepSeek V4 Pro) предлагает черты → KNN-merge с уже активными чертами → decay по времени → метрики и probe-события.
4. **Каждая черта получает «смысловой блок навыка»** (`SkillTraitConcept`) — канонизированное имя категории (не «осторожен с оценками сроков» / «не любит давать сроки без данных» по отдельности, а один концепт). Ночной cron сливает близкие концепты.
5. **Раз в неделю в воскресенье** платформа собирает snapshot `ExecutablePersona` — версионированный «персонаж» сотрудника и агрегатный персонаж роли (по топ-чертам всех носителей этой должности).
6. **Каждые 2 часа** trigger-watcher проверяет — нужен ли внеплановый rebuild персоны: набралось ли ≥ 2 новых traits за 24 ч, не устарел ли активный snapshot больше чем на 48 ч.
7. **Каждый понедельник в 9 утра** прямой руководитель получает дайджест «новые черты у подчинённых за прошлую неделю».
8. **Сотрудник заходит на `/clones`** — видит маркетплейс ролевых клонов, может открыть детальную карточку, начать чат с клоном роли (через chat-v2 conversation).
9. **При ASK** клон проверяет: есть ли ≥ 2 reasoning-блоков сотрудника с косинусной близостью ≥ 0.70 к вопросу. Если нет — отказ без LLM. Если да — `clone-respond` (или `dialog-multi-query-clone` для v2) с действующим snapshot персоны как system prompt.
10. **Если прямой руководитель** считает черту неверной — `POST /clones/skill-traits/:id/mark-misleading`. Черта помечена misleading, при критической severity триггерит rebuild персоны.

## 4. Что получается на выходе

- **Кому:**
  - сотруднику-носителю — через `/me/clone` (редирект на `/clones`); видит собственный профиль и может задать вопрос своему клону;
  - другим member'ам Org — клон роли (если выдан `CloneAccessGrant`); персональный клон сотрудника — только при явном гранте;
  - прямому руководителю — read доступ к профилям подчинённых + кнопка mark-misleading;
  - owner/admin — все профили и грант-CRUD;
  - manager'у — еженедельный дайджест.
- **В каком виде:**
  - запись `SkillProfile` + `SkillTrait[]` + `ExecutablePersona` (версии),
  - REST `/api/v1/clones/*` (ask / skill-profile / history),
  - in-app + Telegram уведомления (manager digest, probe-события `skill.profile_starved`, `skill.contradicting_traits`, `clone.access_granted`, `skill.concepts_merged`),
  - Prometheus метрики (см. раздел 6).
- **Где это видно:**
  - `/clones` — маркетплейс ролевых клонов,
  - `/clones/[roleId]` — детальная карточка клона роли,
  - `/clones/[roleId]/chat/[conversationId]` — диалог с клоном,
  - `/roles/[id]/clone` — карточка клона роли (legacy URL),
  - `/roles/[id]/clone/history` — история версий клона,
  - `/admin/clones` — admin CRUD грантов,
  - `/admin/skill-trait-concepts` — управление смысловыми блоками навыка.

**НЕ показывается** (по решению 2026-05-25, см. memory `project_clones_are_role_based`):
- `/me/clone` — redirect → `/clones` (`frontend/app/(authenticated)/me/clone/page.tsx`).
- `/persons/:id/skill-profile` — redirect → `/persons/:id` (`frontend/app/(authenticated)/persons/[id]/skill-profile/page.tsx`). Это **подтверждённое расхождение с ТЗ γ-1** — изначально страница была обязательной, по решению владельца переехала в раздел 8.

## 5. Технический разрез (по шагам)

| # | Шаг (бытовой) | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Reasoning-блок прилетел | Block-ingest пометил `IdeaBlockEntity.role='subject'`, `signalType ∈ {reasoning, rationale, decision_basis}`; canonical-блок попадает в RouterService.dispatch | `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts`, `router.service.ts` | `core.specialist-routing` (jobName=`3-7-skill`) | `IdeaBlock`, `IdeaBlockEntity` | ✅ |
| 2 | Диспетчер 3-7 | `Specialist37SkillWorker.process` фильтрует Person'у `relationship='employee'`, создаёт/находит `SkillProfile` (1:1 с Person), вызывает `enqueueRebuildSkillProfile(debounce=cfg.skill.rebuildDebounceMs)` | `backend/src/modules/knowledge-core/workers/specialist-3-7-skill.worker.ts:177`, `backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts` | `core.skill-profile-rebuild` (jobId=`skill-profile-rebuild_<profileId>`, debounce 60s) | `SkillProfile` | ✅ |
| 3 | Rebuild профиля | `SkillProfileRebuildWorker` → `Specialist37Service.rebuildProfile`: KNN-группировка reasoning-блоков (минимум `SKILL_MIN_OBSERVATIONS=5`); LLM `skill-trait-detect` (DeepSeek V4 Pro, primary закреплён в `LlmTaskRoute.pinnedVersionNote`); LLM `skill-trait-merge` с активными traits; decay; `createNewTraitRaw` сразу зовёт `findOrCreateConcept` | `backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts`, `backend/src/modules/knowledge-core/services/skill-trait-concept.service.ts` | LLM `skill-trait-detect`, `skill-trait-merge` | `SkillTrait`, `SkillProfile.lastBuildAt`, `buildVersion` | ✅ |
| 4 | Smысловые блоки навыка | На создание trait — синхронно `SkillTraitConceptService.findOrCreateConcept` (embed `category + statement`, KNN top-1, порог `cfg.skill.conceptMatchThreshold=0.85`); ночной `SkillTraitConceptNormalizerCron` (`0 3 * * *`) — union-find кластеризация по порогу `cfg.skill.conceptMergeThreshold=0.92`, LLM `skill-trait-concept-name` (DeepSeek V4 Flash) только при слиянии 2+ концептов; probe `skill.concepts_merged` если кластер содержал разные `canonicalName` и ≥ 5 traits | `backend/src/modules/knowledge-core/workers/skill-trait-concept-normalizer.cron.ts`, `backend/src/modules/knowledge-core/services/skill-trait-concept.service.ts` | LLM `skill-trait-concept-name`, `@Cron('0 3 * * *')` | `SkillTraitConcept`, `SkillTrait.conceptId` | ✅ |
| 5 | Weekly persona snapshot | `ExecutablePersonaBuildCron` (`0 6 * * SUN`) собирает scope='person' для каждого active SkillProfile с ≥ `cfg.persona.minTraits` черт + scope='role' для каждой Role с ≥ `cfg.persona.roleAggMinPersons` employee'ев; LLM `executable-persona-compile`; gated мастер-тумблером `cfg.persona.scheduledRebuildEnabled` | `backend/src/modules/knowledge-core/workers/executable-persona-build.cron.ts:19`, `backend/src/modules/knowledge-core/services/executable-persona-build.service.ts` | `@Cron('0 6 * * SUN')`, LLM `executable-persona-compile` | `ExecutablePersona` (новая версия, `roleVersion`, `currentBearerPersonId`, `publicName`, `succeedsPersonaId`) | ✅ |
| 6 | Реактивный rebuild персоны | `ExecutablePersonaTriggerWatcherCron` (`0 */2 * * *`) — 3 триггера: `critical` (новый misleading severity=critical), `trait_delta` (≥ `cfg.skill.personaRebuildTraitDeltaThreshold=2` новых traits за 24ч), `max_age` (snapshot старше `cfg.skill.personaRebuildMaxAgeHours=48`); Redis-замок per profile через `ExecutablePersonaVersioningService.triggerRebuild`; counter `persona_rebuild_triggered_total{reason}` | `backend/src/modules/knowledge-core/workers/executable-persona-trigger-watcher.cron.ts:38`, `backend/src/modules/knowledge-core/services/executable-persona-versioning.service.ts` | `@Cron('0 */2 * * *')` | `ExecutablePersona` (новая версия) | ✅ |
| 7 | Manager digest | `SkillManagerDigestCron` (`0 9 * * MON`) обходит manager'ов, считает новые traits у подчинённых за неделю, шлёт `ConversationalService.sendNotification(eventType='system.message')` со ссылкой на curation page фильтр `skill_misleading_candidates` | `backend/src/modules/knowledge-core/workers/skill-manager-digest.cron.ts:21` | `@Cron('0 9 * * MON')` | `Notification` (in-app + Telegram) | ✅ |
| 8 | UI маркетплейса | `/clones`, `/clones/[roleId]`, `/clones/[roleId]/chat/[conversationId]`, `/admin/clones` — frontend; REST `GET /api/v1/clones`, `/conversations`, `/persons/:id/skill-profile`, `/roles/:id/skill-profile`, `/me/clone-access` | `frontend/app/(authenticated)/clones/`, `backend/src/modules/clones/clones.controller.ts:59`, `backend/src/modules/clones/services/clones-admin.service.ts` | `GET /api/v1/clones`, `/conversations`, `/persons/:id/skill-profile`, `/roles/:id/skill-profile`, `/me/clone-access`, `/me/clone-access` | `ChatV2Conversation` (mode='clone_style', scope='card') | ✅ |
| 9 | ASK с антифальшивкой | `POST /clones/persons/:id/ask` или `/roles/:id/ask`; `ClonesService.askPerson/askRole` сначала проверяет ≥ `cfg.skill.cloneTopicMinBlocks=2` блоков с косинусной близостью ≥ `cfg.skill.cloneTopicSimilarityThreshold=0.70` к вопросу — иначе `{refused: true, refusalReason}` без LLM, метрика `clone_ask_refused_total{reason}`; иначе LLM `clone-respond` (v1) или `dialog-multi-query-clone` (v2, DeepSeek V4 Pro, под флагом `CLONE_V2_ENABLED`); rate-limit `cfg.skill.cloneAskPerUserPerDay=20` через Redis (`clones.service.ts:1911`) | `backend/src/modules/clones/services/clones.service.ts`, `backend/src/modules/clones/clones.controller.ts:163-203`, `backend/src/modules/chat-v2/services/synthesis.service.ts:104-140` (делегирование `mode='clone_style'`) | `POST /clones/persons/:id/ask`, `/roles/:id/ask`, LLM `clone-respond`, `dialog-multi-query-clone` | `CloneAsk` (если запись), `ChatV2Message` | ✅ |
| 10 | Mark misleading | `POST /clones/skill-traits/:id/mark-misleading` (RBAC: owner/admin/direct manager); `CurationDecisionType.mark_as_misleading`; критический severity триггерит rebuild персоны через trigger-watcher | `backend/src/modules/clones/clones.controller.ts:262`, `backend/src/modules/clones/services/clones.service.ts` | `POST /clones/skill-traits/:id/mark-misleading` | `SkillTrait.status='misleading'`, `misleadingReason`, `misleadingFlaggedByUserId`, `misleadingFlaggedAt` | ✅ |
| 11 | Probe-trigger'ы | `skill.profile_starved` (employee > 3 мес, reasoning-блоков < 5 за 3 мес) → direct manager / admin; `skill.contradicting_traits` (новая черта противоречит существующей high-confidence) → direct manager | `backend/src/modules/knowledge-core/services/specialist-3-7-skill-probe.service.ts` | через `ProbeService.suggest` → `core.probe-events` | `ProbeEvent` | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
IdeaBlock (signalType ∈ {reasoning, rationale, decision_basis}) + IdeaBlockEntity (role='subject', kind='person')
  ↓ RouterService.dispatch → core.specialist-routing jobName='3-7-skill'
SkillProfile (1:1 Person, status, lastBuildAt, buildVersion)
  ↓ debounce 60s → core.skill-profile-rebuild
SkillTrait (category, categoryId, statement, confidence, observationCount,
            sourceBlockIds, status, supersededById, misleadingReason, embedding,
            conceptId)
  ↓ findOrCreateConcept (sync)
SkillTraitConcept (canonicalName, variants[], embedding, status, mergedIntoId,
                   traitCount)
  ↓ cron 0 6 * * SUN  + cron 0 */2 * * * (реактивный) + on-demand
ExecutablePersona (scope: person | role, profileId, scopeRefId, version,
                   personaPrompt, includedTraitIds[], status, triggerReason,
                   triggerEventAt, roleVersion, currentBearerPersonId,
                   publicName, succeedsPersonaId)
  ↓ POST /clones/.../ask → ClonesService.askPerson | askRole
ChatV2Conversation (mode='clone_style', scope='card') + ChatV2Message
  ↓ POST /clones/skill-traits/:id/mark-misleading
SkillTrait.status='misleading' + (опц.) ExecutablePersonaTriggerWatcher.critical
```

Модели — `schema.prisma`: `SkillProfile` (:6349), `SkillTrait` (:6377), `SkillTraitConcept` (:6433), `SkillTraitCategory` (:6480), `ExecutablePersona` (:6510). RBAC `skill_profile` + `clone_persona` — `backend/src/modules/rbac/policies/policy.csv:452-473,660`.

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где промпт / pinnedVersionNote |
|---|---|---|---|---|
| 3 | `skill-trait-detect` | **DeepSeek V4 Pro** (закреплено 2026-05-25, snapshot-тест защищает) | OpenAI gpt-5.4 → Ollama qwen3:30b | `backend/scripts/seed-llm-task-routes-skill-and-clone.ts`, snapshot-тест `seed-llm-task-routes-skill-and-clone.snapshot.spec.ts`, golden-набор `backend/test/eval/skill-trait-detect-golden/` |
| 3 | `skill-trait-merge` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3:30b | seed `seed-llm-task-routes-skill-and-clone.ts` |
| 4 | `skill-trait-concept-name` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3:30b | seed `seed-llm-task-routes-skill-concept.ts` |
| 5/6 | `executable-persona-compile` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3:30b | seed `seed-llm-task-routes-skill-and-clone.ts` |
| 9 (v1) | `clone-respond` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3:30b | `backend/src/modules/clones/prompts/clone-respond.prompt.ts` |
| 9 (v2) | `dialog-multi-query-clone` | DeepSeek V4 Pro | OpenAI gpt-5.4 → Ollama qwen3.5:9b | `backend/src/modules/chat-v2/prompts/clone-style.prompt.ts`, под флагом `CLONE_V2_ENABLED` |

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `skill_profiles_active_total` (gauge) — обновляется recalibrate cron'ом.
- `skill_traits_per_profile` (histogram) — наблюдение на каждый профиль.
- `skill_traits_marked_misleading_total{category}` — счётчик.
- `persona_active_total{scope}` (gauge), `persona_build_duration_seconds` (histogram).
- `persona_rebuild_triggered_total{reason='trait_delta'|'max_age'|'critical'}`.
- `clone_ask_total{scope}`, `clone_ask_refused_total{reason}`, `clone_ask_by_owner_total`.
- `skill_trait_concepts_total{status}`, `skill_trait_concepts_merged_total`.
- `core_specialist_*{type='skill_trait'}`.

**BullMQ очереди:**
- `core.specialist-routing` (jobName=`3-7-skill`).
- `core.skill-profile-rebuild` (concurrency=1, debounce 60s).
- `core.probe-events`.
- `conversational.send` (manager digest, probe-уведомления).

**Логи:** `Specialist37SkillWorker`, `SkillProfileRebuildWorker`, `Specialist37Service`, `SkillProfileRecalibrateCron`, `ExecutablePersonaBuildCron`, `ExecutablePersonaTriggerWatcherCron`, `SkillManagerDigestCron`, `SkillTraitConceptNormalizerCron`, `ClonesService`, `Specialist37SkillProbeService`. Контекст — `profileId`, `personId`, `traitId`, `tenantId`, `conceptId`.

**Известные грабли:**
- `@Cron` принимает только литералы — ENV `SKILL_RECALIBRATE_CRON`, `PERSONA_BUILD_CRON`, `SKILL_MANAGER_DIGEST_CRON` в схеме есть, но в декораторе зашиты литералы. Для runtime-настройки нужен `SchedulerRegistry`.
- `SkillTrait.category` (free-string) и `SkillTrait.categoryId` (FK на `SkillTraitCategory`) живут параллельно — backfill patch-скрипт мигрирует, но deprecated-поле пока остаётся (см. `schema.prisma:6380-6388`).
- DeepSeek V4 Pro для `skill-trait-detect` без auto-конвертации `json_schema → tool` падал — фикс в `DeepSeekService.buildParams` (2026-05-25, коммит `a8b2ab6`). Любой возврат на старую версию SDK сломает извлечение черт.
- При rebuild персоны Redis-замок per-profile через `ExecutablePersonaVersioningService` — без него триггер-watcher может дёрнуть одну персону несколько раз параллельно.
- Snapshot-тест `seed-llm-task-routes-skill-and-clone.snapshot.spec.ts` ломается на любой правке цепочки моделей — это by design.

**Кнопки админки:**
- `/admin/llm-routes` — warning для пустого `pinnedVersionNote` критических цепочек (`skill-trait-detect, clone-respond, block-ingest`).
- `/admin/skill-trait-concepts` — merge / archive концептов с обязательным обоснованием.
- `/admin/clones` — admin CRUD `CloneAccessGrant` (grant / revoke / extend).
- `/admin/curation` — фильтр `skill_misleading_candidates`.
- `/admin/platform/workers` — повторить упавший rebuild job.

## 7. Связанные процессы

- [[meeting-post-processing]] — главный источник reasoning-блоков (Шаг 7б). Клон обновляется **не синхронно с этим процессом** — пересборка идёт по cron'у + реактивному watcher'у, не сразу после встречи.
- [[raw-event-to-graph]] — общий конвейер `IdeaBlock` (Шаг 1 здесь — выход оттуда).
- [[probe-question-flow]] — probe-trigger'ы `skill.profile_starved`, `skill.contradicting_traits`, `skill.concepts_merged` уходят отсюда.
- [[notification-dispatch]] — manager digest и in-app/Telegram уведомления о grants.

## 8. Расхождения «задумано vs реализовано»

**Реактивный rebuild персоны vs только-cron (задано в задаче):**
- ТЗ γ-1 изначально требовало weekly cron `0 6 * * SUN`. ТЗ `clone-reliability-hardening` (фаза 5, 2026-05-25) добавил реактивный режим. На сегодня **оба режима работают параллельно**: weekly snapshot гарантирует обновление даже без активности, trigger-watcher (`0 */2 * * *`) пересобирает по `trait_delta ≥ 2 за 24ч`, `max_age > 48ч`, `critical` (mark_misleading severity=critical). Реактивная пересборка от события «встреча закончилась» в коде НЕТ — между блоком и снапсшотом всё равно есть 60-секундный debounce profile-rebuild и до 2 часов до watcher'a. См. карточку [[meeting-post-processing]] §8.

**Статус ТЗ `clone-reliability-hardening` (фаза 5):**
- Закрыто 7 фаз из 8 (см. рефлексию `05_история/2026-05-25-clone-reliability-hardening-wave.md`). Антифальшивка (Фаза 1), `SkillTraitConcept` (Фаза 2), probe-получатели через `Department.headPersonId` (Фаза 3), реактивный rebuild (Фаза 5), pinned-version note + golden-набор (Фаза 6), Фаза 6.1 переключение на DeepSeek V4 Pro — все реализованы. Не закрытая фаза 8 — финальные manager validation notes (ручной dev-review «traits похожи на правду»), это процесс приёмки, не код.

**Заложено в ТЗ γ-1 «ОБЯЗАТЕЛЬНО», реализовано через redirect (Clones=Roles переворот 2026-05-25):**
- `/me/clone` — должна была быть полноценная страница «Попробовать своего клона» (γ-1 §3.3 правило C5). По решению `project_clones_are_role_based` (2026-05-25) клоны стали ролевыми → файл `frontend/app/(authenticated)/me/clone/page.tsx:5` теперь `redirect('/clones')`. **Подтверждено в коде**.
- `/persons/:id/skill-profile` — должна была быть страница «для manager / admin / self» (γ-1 §UI). По тому же решению → `frontend/app/(authenticated)/persons/[id]/skill-profile/page.tsx:15` `redirect('/persons/:id')`. **Подтверждено в коде**. Старый URL `/clones/persons/.../skill-profile` API сохранён для совместимости (см. `frontend/src/api/clones.api.ts:243`).
- `/roles/:id/skill-profile` — в коде есть `/roles/:id/clone` и `/roles/:id/clone/history` (карточка клона роли + версии), агрегатный skill-profile-просмотр на отдельном маршруте отсутствует. Read доступен через REST `GET /api/v1/clones/roles/:roleId/skill-profile`, но UI-маршрут — не реализован.

**Реализовано, но не описано в исходном ТЗ γ-1:**
- `SkillTraitCategory` first-class модель (γ-1 «doneли») — заменяет free-string `SkillTrait.category` (см. ТЗ `2026-05-23-sba-gamma-1-finishing-skilltraitcategory-persona-versioning.md`).
- `CloneAccessGrant` модель и admin CRUD (ТЗ `2026-05-26-clone-access-grant-admin-api.md`) — per-pair (grantee × subject) с `expiresAt` / `revokedAt`, admin-страница `/admin/clones`.
- `Clones=Roles` маркетплейс `/clones`, `/clones/[roleId]`, `/clones/[roleId]/chat/[conversationId]` (ТЗ `2026-05-26-clones-marketplace-frontend.md`).
- v2 диалоги через `ChatV2Conversation(mode='clone_style', scope='card')` под флагом `CLONE_V2_ENABLED` — параллельно с v1 one-shot. Делегирование в `SynthesisService.synthesize` Шаг 9: при `mode='clone_style' && scope='card'` → `ClonesService.askPerson` (см. `synthesis.service.ts:98-140`).

**Отложено / γ+:**
- Frontend-группировка traits по `conceptId` вместо `category` (см. `01_projects/skill-trait-concepts.md` «Что осталось»).
- Аналитика «топ-смысловых блоков компании» на дашборде CEO.
- SkillTrait.category отдельной моделью с иерархией — задел `parentCategoryId` есть, активно не используется.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-26 | `CloneAccessGrant` admin CRUD + frontend marketplace | коммиты `fc3d6fe`, `c96505a`, `87fef5d`, `578a777`, `eab4d8f` |
| 2026-05-25 | Clone-reliability-hardening (антифальшивка / SkillTraitConcept / реактивный rebuild / pinnedVersionNote / golden-набор) | `05_история/2026-05-25-clone-reliability-hardening-wave.md` |
| 2026-05-25 | Clones=Roles переворот — клоны по должности, redirects `/me/clone` и `/persons/:id/skill-profile` | memory `project_clones_are_role_based` |
| 2026-05-25 | Фаза 6.1 — primary `skill-trait-detect` → DeepSeek V4 Pro | `05_история/2026-05-25-clone-reliability-hardening-wave.md` |
| 2026-05-22 | Запуск γ-1 — SkillProfile + ExecutablePersona + Clone API | `01_projects/skill-and-clone.md` |
